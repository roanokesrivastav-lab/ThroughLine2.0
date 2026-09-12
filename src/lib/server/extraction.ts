import "server-only";
import type { Db } from "./entries";
import { getExtractor } from "@/lib/ai/extractor";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import type { Category, Dimensions } from "@/lib/types";
import type { ExtractedAttributesRow, MediaItemsRow, ReactionsRow } from "@/lib/db/types";
import { asDimensions } from "@/lib/db/types";

/**
 * Save-time: insert a pending row so the queue exists even if the process dies.
 * The reaction itself is already saved; this never blocks the UI.
 */
export async function queueExtraction(db: Db, args: { reactionId: string; entryId: string; userId: string }) {
  const { error } = await db.from("extracted_attributes").upsert(
    { reaction_id: args.reactionId, entry_id: args.entryId, user_id: args.userId, status: "pending", vocabulary_version: VOCABULARY_VERSION },
    { onConflict: "reaction_id,vocabulary_version", ignoreDuplicates: true },
  );
  if (error) console.error("[extraction] queue failed:", error.message);
}

type PendingJoin = ExtractedAttributesRow & { reactions: (ReactionsRow & { entries: { media_items: MediaItemsRow | null } | null }) | null };

/** Runs pending/failed extractions. Works with either an RLS client (one user) or the admin client (cron, all users). */
export async function runPendingExtractions(db: Db, opts: { userId?: string; limit?: number; maxAttempts?: number } = {}) {
  const { userId, limit = 20, maxAttempts = 5 } = opts;
  let q = db.from("extracted_attributes")
    .select("*, reactions(*, entries(media_items(*)))")
    .neq("status", "done").lt("attempts", maxAttempts)
    .order("created_at", { ascending: true }).limit(limit);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) { console.error("[extraction] load failed:", error.message); return { processed: 0, failed: 0 }; }

  const extractor = getExtractor();
  let processed = 0, failed = 0;
  for (const row of (data ?? []) as unknown as PendingJoin[]) {
    const reaction = row.reactions;
    const item = reaction?.entries?.media_items;
    if (!reaction || !item) { await db.from("extracted_attributes").update({ status: "failed", last_error: "missing reaction or item", attempts: row.attempts + 1 }).eq("id", row.id); failed++; continue; }
    try {
      const result = await extractor.extract({
        note: reaction.raw_note, dimensions: asDimensions(reaction.dimensions) as Dimensions,
        category: item.category as Category, title: item.title, subtitle: item.subtitle,
      });
      await db.from("extracted_attributes").update({
        status: "done", attributes: result.extraction as unknown as ExtractedAttributesRow["attributes"], vector: result.vector as unknown as ExtractedAttributesRow["vector"],
        vocabulary_version: result.vocabulary_version, extractor: result.extractor, attempts: row.attempts + 1, last_error: null, extracted_at: new Date().toISOString(),
      }).eq("id", row.id);
      processed++;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error("[extraction] failed:", msg);
      await db.from("extracted_attributes").update({ status: "failed", last_error: msg.slice(0, 500), attempts: row.attempts + 1 }).eq("id", row.id);
      failed++;
    }
  }
  return { processed, failed };
}
