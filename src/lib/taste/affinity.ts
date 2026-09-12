import type { AttributeVector, EntryWithContext, Extraction } from "@/lib/types";
import { blend, isEmpty, scale } from "./vector";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How much the user loves this entry, 0..1. Built from what they tapped and wrote,
 * with the private score as a coarse, low-weight nudge — never the main signal.
 */
export function affinity(e: EntryWithContext): number {
  if (e.entry.status === "want") return 0;
  let a = e.entry.status === "dropped" ? 0.15 : 0.5;
  const dims = Object.assign({}, ...e.reactions.map((r) => r.dimensions ?? {}));
  if (dims.loved) a += 0.3;
  if (dims.moved_me) a += 0.18;
  if (dims.stuck_with_me) a += 0.18;
  if (dims.would_return) a += 0.14;
  if (dims.changed_perspective) a += 0.14;
  if (dims.comforted_me) a += 0.1;
  if (dims.challenged_me) a += 0.08;
  if (e.reactions.some((r) => (r.raw_note ?? "").trim().length > 20)) a += 0.08; // they bothered to write
  if (e.entry.private_score != null) a += ((e.entry.private_score - 5.5) / 10) * 0.3;
  for (const r of e.resurfaces) {
    if (r.response === "still_hits") a += 0.15;
    if (r.response === "doesnt_hit") a -= 0.35;
  }
  return clamp01(a);
}

export function hasStrongReaction(e: EntryWithContext): boolean {
  return affinity(e) >= 0.7;
}

/** The latest completed extraction for an entry, if any. */
export function latestExtraction(e: EntryWithContext): Extraction | null {
  const done = e.extractions
    .filter((x) => x.status === "done" && x.attributes)
    .sort((x, y) => (y.extracted_at ?? "").localeCompare(x.extracted_at ?? ""));
  return done[0]?.attributes ?? null;
}

/**
 * The attribute vector that represents this entry for the user:
 * extracted attributes from their words (newest weighted highest), falling back
 * to a faint prior from the catalog when they have not written anything.
 */
export function entryVector(e: EntryWithContext): AttributeVector | null {
  const done = e.extractions
    .filter((x) => x.status === "done" && x.vector)
    .sort((x, y) => (y.extracted_at ?? "").localeCompare(x.extracted_at ?? ""));
  if (done.length) {
    const parts = done.map((x, i) => ({ v: x.vector as AttributeVector, w: i === 0 ? 1 : 0.5 }));
    const v = blend(parts);
    if (e.item.feel_prior && !isEmpty(e.item.feel_prior)) {
      return blend([{ v, w: 1 }, { v: e.item.feel_prior, w: 0.25 }]);
    }
    return v;
  }
  if (e.item.feel_prior && !isEmpty(e.item.feel_prior)) return scale(e.item.feel_prior, 0.85);
  return null;
}

export function hasOwnWords(e: EntryWithContext): boolean {
  return e.extractions.some((x) => x.status === "done" && x.vector);
}

export function bestQuote(e: EntryWithContext): string | null {
  const x = latestExtraction(e);
  if (x?.quote) return x.quote;
  const note = e.reactions.map((r) => r.raw_note?.trim()).find((n) => n && n.length > 0);
  if (!note) return null;
  const first = note.split(/(?<=[.!?])\s+/)[0];
  return first.length > 140 ? first.slice(0, 137) + "…" : first;
}

export function entryDate(e: EntryWithContext): Date {
  return new Date(e.entry.consumed_at ?? e.entry.created_at);
}
