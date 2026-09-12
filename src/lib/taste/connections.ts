import type { Connection, EntryWithContext, WeightedTag } from "@/lib/types";
import { affinity, bestQuote, entryVector, hasOwnWords, latestExtraction } from "./affinity";
import { similarity } from "./vector";
import { describeKey } from "./vocabulary";

export type ConnectionOptions = {
  limit?: number;
  minSimilarity?: number;
  minAffinity?: number;
  maxPerEntry?: number;
  focusEntryId?: string;
};

/**
 * Engine A. Finds pairs across *different* categories whose extracted feeling overlaps.
 * Ranking is deterministic: similarity × how much the user loved both, with a small bonus
 * when both sides carry the user's own words rather than catalog priors.
 */
export function findConnections(entries: EntryWithContext[], opts: ConnectionOptions = {}): Connection[] {
  const { limit = 5, minSimilarity = 0.42, minAffinity = 0.5, maxPerEntry = 2, focusEntryId } = opts;
  const pool = entries
    .map((e) => ({ e, v: entryVector(e), aff: affinity(e) }))
    .filter((x) => x.v && x.aff >= minAffinity);

  const pairs: Array<Connection & { rank: number }> = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const A = pool[i], B = pool[j];
      if (A.e.item.category === B.e.item.category) continue;
      if (focusEntryId && A.e.entry.id !== focusEntryId && B.e.entry.id !== focusEntryId) continue;
      const sim = similarity(A.v!, B.v!);
      if (sim.score < minSimilarity || sim.shared.length === 0) continue;
      const wordsBonus = (hasOwnWords(A.e) ? 0.08 : 0) + (hasOwnWords(B.e) ? 0.08 : 0);
      const rank = sim.score * Math.min(A.aff, B.aff) + wordsBonus;
      // Put the side with the user's own words first so the explanation can quote it.
      const [a, b] = hasOwnWords(B.e) && !hasOwnWords(A.e) ? [B.e, A.e] : [A.e, B.e];
      pairs.push({ a, b, similarity: sim.score, shared: sim.shared, explanation: explainConnection(a, b, sim.shared), rank });
    }
  }
  pairs.sort((x, y) => y.rank - x.rank);

  const seen = new Map<string, number>();
  const out: Connection[] = [];
  for (const p of pairs) {
    const ca = seen.get(p.a.entry.id) ?? 0, cb = seen.get(p.b.entry.id) ?? 0;
    if (ca >= maxPerEntry || cb >= maxPerEntry) continue;
    seen.set(p.a.entry.id, ca + 1);
    seen.set(p.b.entry.id, cb + 1);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** Plain-language "why" for a connection, built from the user's own words where possible. */
export function explainConnection(a: EntryWithContext, b: EntryWithContext, shared: WeightedTag[]): string {
  const xa = latestExtraction(a);
  const xb = latestExtraction(b);
  const qa = bestQuote(a);
  const qb = bestQuote(b);
  const phrase = sharedPhrase(shared);
  const first = xa?.summary
    ? `You loved the ${xa.summary} in ${a.item.title}.`
    : qa
      ? `Of ${a.item.title} you wrote “${qa}”${/[.!?…]$/.test(qa) ? "" : "."}`
      : `${a.item.title} stayed with you.`;
  const second = xb?.summary
    ? `That same ${phrase} runs through ${b.item.title} — the ${xb.summary} you described.`
    : qb
      ? `That same ${phrase} is in ${b.item.title}: “${qb}”${/[.!?…]$/.test(qb) ? "" : "."}`
      : `That same ${phrase} appears in ${b.item.title}.`;
  return `${first} ${second}`;
}

export function sharedPhrase(shared: WeightedTag[]): string {
  const keys = shared.slice(0, 2).map((s) => describeKey(s.key));
  if (keys.length === 0) return "feeling";
  if (keys.length === 1) return keys[0];
  return `${keys[0]} and ${keys[1]}`;
}
