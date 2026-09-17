// Builds a full in-memory library from the demo seeds, running the mock extractor,
// so the engines can be exercised (tests, previews) without a database.
import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { mockExtract } from "@/lib/ai/mock-extractor";
import { SEEDS } from "@/lib/server/demo-seeds";
import type { EntryWithContext, MediaItem } from "@/lib/types";

const iso = (daysAgo: number, now: number) => new Date(now - daysAgo * 86_400_000).toISOString();

export function buildFixtureLibrary(now = Date.now()): EntryWithContext[] {
  const seen = new Set<string>();
  const out: EntryWithContext[] = [];
  for (const s of SEEDS) {
    if (seen.has(s.slug)) continue;
    seen.add(s.slug);
    const canon = CANON_BY_SLUG.get(s.slug);
    if (!canon) continue;
    const r = canonToResult(canon);
    const item: MediaItem = { ...r, id: `item-${s.slug}`, feel_prior: r.feel_prior ?? null };
    const entryId = `entry-${s.slug}`;
    const created = iso(s.daysAgo, now);
    const e: EntryWithContext = {
      entry: { id: entryId, user_id: "u", media_item_id: item.id, status: s.status ?? "completed", private_score: s.score ?? null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day", origin: "demo", created_at: created, updated_at: created },
      item, reactions: [], extractions: [], resurfaces: [],
    };
    if (s.note || (s.dims && Object.keys(s.dims).length)) {
      const reactionId = `reaction-${s.slug}`;
      e.reactions.push({ id: reactionId, entry_id: entryId, user_id: "u", dimensions: s.dims ?? {}, raw_note: s.note ?? null, source: "demo", created_at: created });
      const x = mockExtract({ note: s.note ?? null, dimensions: s.dims ?? {}, category: item.category, title: item.title, subtitle: item.subtitle });
      e.extractions.push({ id: `x-${s.slug}`, reaction_id: reactionId, entry_id: entryId, user_id: "u", status: "done", attributes: x.extraction, vector: x.vector, vocabulary_version: x.vocabulary_version, extractor: "mock", attempts: 1, last_error: null, extracted_at: created, created_at: created });
    }
    if (s.resurface) {
      const when = iso(Math.max(1, s.daysAgo - 120), now);
      e.resurfaces.push({ id: `rs-${s.slug}`, user_id: "u", entry_id: entryId, surfaced_at: when, channel: "home", response: s.resurface, responded_at: when, note_reaction_id: null, snoozed_until: null });
    }
    out.push(e);
  }
  return out;
}
