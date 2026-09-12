import type { EntryWithContext } from "@/lib/types";
import { affinity, bestQuote, latestExtraction } from "@/lib/taste/affinity";
import { topTags } from "@/lib/taste/vector";
import { describeKey } from "@/lib/taste/vocabulary";
import { entryVector } from "@/lib/taste/affinity";

/** What the client needs to render an entry, without leaking internals or bloating payloads. */
export type EntryDTO = {
  id: string;
  status: EntryWithContext["entry"]["status"];
  private_score: number | null;
  consumed_at: string | null;
  created_at: string;
  origin: EntryWithContext["entry"]["origin"];
  item: EntryWithContext["item"];
  reactions: EntryWithContext["reactions"];
  extraction: { status: "pending" | "done" | "failed" | "none"; summary: string | null; quote: string | null; tags: Array<{ key: string; weight: number; label: string }> };
  affinity: number;
  lastResurface: { response: string | null; surfaced_at: string } | null;
};

export function serializeEntry(e: EntryWithContext): EntryDTO {
  const x = latestExtraction(e);
  const v = entryVector(e);
  const latest = e.extractions.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const status = latest ? latest.status : "none";
  return {
    id: e.entry.id, status: e.entry.status, private_score: e.entry.private_score, consumed_at: e.entry.consumed_at, created_at: e.entry.created_at, origin: e.entry.origin,
    item: e.item, reactions: e.reactions,
    extraction: { status: x ? "done" : status, summary: x?.summary ?? null, quote: bestQuote(e), tags: v ? topTags(v, 4, 0.35).map((t) => ({ ...t, label: describeKey(t.key, t.weight) })) : [] },
    affinity: affinity(e),
    lastResurface: e.resurfaces[0] ? { response: e.resurfaces[0].response, surfaced_at: e.resurfaces[0].surfaced_at } : null,
  };
}
