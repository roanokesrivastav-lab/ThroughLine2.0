import type { EntryWithContext, NotificationPrefs, ResurfaceEvent } from "@/lib/types";
import { affinity, entryDate, hasOwnWords } from "./affinity";

const DAY = 86_400_000;

/**
 * Pick the next entry to resurface. Deterministic score biased toward:
 * older entries, strong original reactions, and things not surfaced recently.
 * Returns null when nothing qualifies (anti-annoyance: better silence than noise).
 */
export function pickResurfaceCandidate(entries: EntryWithContext[], now = new Date()): EntryWithContext | null {
  const scored = entries
    .filter((e) => e.entry.status === "completed" || e.entry.status === "dropped")
    .map((e) => {
      const last = e.resurfaces.map((r) => new Date(r.surfaced_at).getTime()).sort((a, b) => b - a)[0];
      const daysSinceSurfaced = last ? (now.getTime() - last) / DAY : Infinity;
      const snoozed = e.resurfaces.some((r) => r.snoozed_until && new Date(r.snoozed_until) > now);
      if (snoozed || daysSinceSurfaced < 30) return null;
      const ageDays = (now.getTime() - entryDate(e).getTime()) / DAY;
      const aff = affinity(e);
      if (aff < 0.45 && !hasOwnWords(e)) return null;
      const score =
        Math.min(1, ageDays / 365) * 0.45 +          // older is better
        aff * 0.35 +                                   // strong original reaction
        (hasOwnWords(e) ? 0.1 : 0) +                   // they wrote something worth revisiting
        Math.min(1, daysSinceSurfaced / 180) * 0.1;    // not surfaced recently
      return { e, score };
    })
    .filter((x): x is { e: EntryWithContext; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.e ?? null;
}

export function cadenceDays(prefs: NotificationPrefs): number | null {
  switch (prefs.cadence) {
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    default: return null;
  }
}

/** Whether a push is due for this user. Aggressive defaults: never more than one per cadence, never with an open card waiting. */
export function pushIsDue(prefs: NotificationPrefs, recent: ResurfaceEvent[], now = new Date()): boolean {
  if (!prefs.push) return false;
  const days = cadenceDays(prefs);
  if (!days) return false;
  if (prefs.snoozed_until && new Date(prefs.snoozed_until) > now) return false;
  const pending = recent.find((r) => r.channel === "push" && !r.response && now.getTime() - new Date(r.surfaced_at).getTime() < 14 * DAY);
  if (pending) return false;
  const lastPush = recent.filter((r) => r.channel === "push").map((r) => new Date(r.surfaced_at).getTime()).sort((a, b) => b - a)[0];
  if (lastPush && now.getTime() - lastPush < days * DAY) return false;
  return true;
}
