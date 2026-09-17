import "server-only";
import { pushConfigured } from "@/lib/server/push";
import { aiProvider, anthropicModel } from "@/lib/ai/extractor";
import { nvidiaModel } from "@/lib/ai/nvidia";
import type { NotificationPrefs } from "@/lib/types";
import type { Db } from "./entries";

const DEFAULT_PREFS: NotificationPrefs = { push: false, cadence: "weekly", snoozed_until: null };

export async function loadProfile(supabase: Db, userId: string, email: string | undefined) {
  let { data } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
  if (!data) {
    // Trigger normally creates this; self-heal for accounts created before the migration ran.
    const { data: created } = await supabase.from("users").insert({ id: userId, email: email ?? null }).select("*").single();
    data = created;
  }
  const prefs = { ...DEFAULT_PREFS, ...((data?.notification_prefs as Partial<NotificationPrefs>) ?? {}) };
  const { count: subs } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const { count: entries } = await supabase.from("entries").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return {
    email: data?.email ?? email ?? null,
    onboardingCompletedAt: data?.onboarding_completed_at ?? null,
    onboardingPrefs: (data?.onboarding_prefs as Record<string, unknown>) ?? {},
    notificationPrefs: prefs,
    pushSubscriptions: subs ?? 0,
    entryCount: entries ?? 0,
    capabilities: { push: pushConfigured(), ai: aiProvider(), aiModel: aiProvider() === "nvidia" ? nvidiaModel() : aiProvider() === "claude" ? anthropicModel() : null, spotify: !!process.env.SPOTIFY_CLIENT_ID?.trim(), tmdb: !!process.env.TMDB_API_KEY, vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null },
  };
}
