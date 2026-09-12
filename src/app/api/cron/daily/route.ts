import { NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabase/admin";
import { runPendingExtractions } from "@/lib/server/extraction";
import { syncPhases } from "@/lib/server/phases";
import { loadLibrary, rowToResurface } from "@/lib/server/entries";
import { pickResurfaceCandidate, pushIsDue } from "@/lib/taste/resurface";
import { sendPush } from "@/lib/server/push";
import type { NotificationPrefs } from "@/lib/types";

/**
 * Daily sweep (Vercel Cron): retry failed extractions, refresh phases, and send
 * one resurfacing push to each user whose cadence says it is due.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 500 });
  const admin = supabaseAdmin();

  const extraction = await runPendingExtractions(admin, { limit: 100 });

  const { data: users } = await admin.from("users").select("id, notification_prefs");
  let phases = 0, pushes = 0;
  for (const u of users ?? []) {
    try {
      await syncPhases(admin, u.id);
      phases++;
      const prefs = { push: false, cadence: "weekly", snoozed_until: null, ...((u.notification_prefs as Partial<NotificationPrefs>) ?? {}) } as NotificationPrefs;
      if (!prefs.push) continue;
      const { data: recent } = await admin.from("resurface_events").select("*").eq("user_id", u.id).order("surfaced_at", { ascending: false }).limit(20);
      if (!pushIsDue(prefs, (recent ?? []).map(rowToResurface))) continue;
      const library = await loadLibrary(admin, u.id);
      const candidate = pickResurfaceCandidate(library);
      if (!candidate) continue;
      const { data: event } = await admin.from("resurface_events").insert({ user_id: u.id, entry_id: candidate.entry.id, channel: "push" }).select("id").single();
      if (!event) continue;
      const sent = await sendPush(admin, u.id, {
        title: "Still hits?",
        body: `${candidate.item.title}${candidate.item.subtitle ? ` · ${candidate.item.subtitle}` : ""}`,
        url: `/resurface?event=${event.id}`,
      });
      pushes += sent;
    } catch (err) {
      console.error(`[cron] user ${u.id} failed:`, err);
    }
  }
  return NextResponse.json({ ok: true, extraction, phasesSynced: phases, pushesSent: pushes });
}
