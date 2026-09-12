import "server-only";
import type { Db } from "./entries";
import { upsertMediaItem } from "./entries";
import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { queueExtraction, runPendingExtractions } from "./extraction";
import { syncPhases } from "./phases";
import { SEEDS } from "./demo-seeds";
import type { ReactionsRow } from "@/lib/db/types";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

/** Seeds the demo library into the *current* user's account. Idempotent per media item. */
export async function seedDemo(db: Db, userId: string) {
  let created = 0;
  const seen = new Set<string>();
  for (const s of SEEDS) {
    if (seen.has(s.slug)) continue;
    seen.add(s.slug);
    const canon = CANON_BY_SLUG.get(s.slug);
    if (!canon) continue;
    const item = await upsertMediaItem(canonToResult(canon));
    const { data: entry, error } = await db.from("entries").upsert(
      { user_id: userId, media_item_id: item.id, status: s.status ?? "completed", private_score: s.score ?? null, consumed_at: day(s.daysAgo), origin: "demo", created_at: iso(s.daysAgo) },
      { onConflict: "user_id,media_item_id" },
    ).select("*").single();
    if (error || !entry) { console.error("[demo] entry failed:", error?.message); continue; }
    created++;
    if (s.note || (s.dims && Object.keys(s.dims).length)) {
      const { data: existing } = await db.from("reactions").select("id").eq("entry_id", entry.id).eq("source", "demo").limit(1);
      if (!existing?.length) {
        const { data: reaction } = await db.from("reactions").insert({
          entry_id: entry.id, user_id: userId, dimensions: (s.dims ?? {}) as ReactionsRow["dimensions"], raw_note: s.note ?? null, source: "demo", created_at: iso(s.daysAgo),
        }).select("*").single();
        if (reaction) await queueExtraction(db, { reactionId: reaction.id, entryId: entry.id, userId });
      }
    }
    if (s.resurface) {
      const { data: existing } = await db.from("resurface_events").select("id").eq("entry_id", entry.id).limit(1);
      if (!existing?.length) {
        await db.from("resurface_events").insert({ user_id: userId, entry_id: entry.id, channel: "home", response: s.resurface, surfaced_at: iso(Math.max(1, s.daysAgo - 120)), responded_at: iso(Math.max(1, s.daysAgo - 120)) });
      }
    }
  }
  // Extraction is normally async; for the demo we run it inline so the mirror is ready immediately.
  const extraction = await runPendingExtractions(db, { userId, limit: 60 });
  const phases = await syncPhases(db, userId);
  await db.from("users").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", userId);
  return { created, extraction, phases };
}
