import { NextResponse, after } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { canonReactSchema } from "@/lib/server/schemas";
import { upsertMediaItem } from "@/lib/server/entries";
import { runPendingExtractions, queueExtraction } from "@/lib/server/extraction";
import { syncPhases } from "@/lib/server/phases";
import type { ReactionsRow } from "@/lib/db/types";

/**
 * One canon card tap.
 * loved / seen: a finished entry (loved also carries a reaction).
 * want: a "Want to" entry, so it lands in the backlog.
 * unsure / never: remembered in prefs only, so the card does not come back. "unsure" also
 * records that they have heard of it, which "never" does not.
 */
export const POST = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const body = canonReactSchema.parse(await req.json());
  const { data: profile } = await supabase.from("users").select("onboarding_prefs").eq("id", user.id).maybeSingle();
  const prefs = (profile?.onboarding_prefs as { canon?: Record<string, string> } | null) ?? {};
  const canon = { ...(prefs.canon ?? {}), [body.result.external_id]: body.response };
  await supabase.from("users").update({ onboarding_prefs: { ...prefs, canon } }).eq("id", user.id);

  if (body.response === "never" || body.response === "unsure") return NextResponse.json({ ok: true });

  const item = await upsertMediaItem(body.result);
  const status = body.response === "want" ? "want" : "completed";
  const { data: prior } = await supabase.from("entries").select("id, status").eq("user_id", user.id).eq("media_item_id", item.id).maybeSingle();
  // Never downgrade something already finished back to "Want to".
  const { data: entry, error } = prior && (status === "want" || prior.status === status)
    ? await supabase.from("entries").select("*").eq("id", prior.id).single()
    : await supabase.from("entries").upsert(
      { user_id: user.id, media_item_id: item.id, status, origin: "canon" },
      { onConflict: "user_id,media_item_id", ignoreDuplicates: false },
    ).select("*").single();
  if (error || !entry) throw new HttpError(500, error?.message ?? "Could not save");
  if (body.response === "loved") {
    const { data: reaction } = await supabase.from("reactions").insert({ entry_id: entry.id, user_id: user.id, dimensions: { loved: true } as ReactionsRow["dimensions"], raw_note: null, source: "onboarding" }).select("id").single();
    if (reaction) await queueExtraction(supabase, { reactionId: reaction.id, entryId: entry.id, userId: user.id });
    after(async () => {
      await runPendingExtractions(supabase, { userId: user.id, limit: 5 }).catch(console.error);
      await syncPhases(supabase, user.id).catch(console.error);
    });
  }
  return NextResponse.json({ ok: true, entryId: entry.id });
});
