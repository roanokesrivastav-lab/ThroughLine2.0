// Pure text helpers for search results. No network, no server-only imports, so they are testable.

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const STOP = new Set(["the", "a", "an", "of", "and", "x", "&"]);
const words = (s: string) => norm(s).split(" ").filter((w) => w && !STOP.has(w));

/**
 * How closely a title matches what was typed: 3 exact, 1 contains every meaningful word, 0 otherwise.
 * "the", "of" and friends are ignored, so "lord of the mysteries" still finds "Lord of Mysteries".
 * Text relevance only. Nothing about how popular or well rated a title is enters this.
 */
export function titleMatch(query: string, title: string): number {
  const q = norm(query), t = norm(title);
  if (!q || !t) return 0;
  if (t === q || words(t).join(" ") === words(q).join(" ")) return 3;
  const tw = new Set(words(t));
  const qw = words(q);
  return qw.length > 0 && qw.every((w) => tw.has(w) || [...tw].some((x) => x.startsWith(w))) ? 1 : 0;
}

/**
 * Merge per-category result lists for an "everything" search.
 * Order: how well the title matches, then how much of the title the query covers (so the film
 * "Spider-Man: Across the Spider-Verse" is not buried under "Across the Spider-Verse (Intro)"),
 * then each provider's own first pick, then a cross-media interleave. When enough titles match,
 * the ones that do not are dropped as noise.
 */
export function rankAcrossCategories<T extends { title: string }>(query: string, perCategory: T[][]): T[] {
  const qLen = words(query).join("").length;
  const scored: Array<{ r: T; score: number; tier: number; order: number }> = [];
  const max = Math.max(0, ...perCategory.map((l) => l.length));
  let order = 0;
  for (let i = 0; i < max; i++) {
    for (const list of perCategory) {
      const r = list[i];
      if (!r) continue;
      const tier = titleMatch(query, r.title);
      const coverage = Math.min(1, qLen / Math.max(1, words(r.title).join("").length));
      scored.push({ r, tier, order: order++, score: tier + 0.5 * coverage + (i === 0 ? 0.3 : 0) - 0.02 * i });
    }
  }
  const matching = scored.filter((x) => x.tier > 0).length;
  return scored
    .filter((x) => matching < 3 || x.tier > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((x) => x.r);
}

/** "Bitter Sweet Symphony - Remastered 2016" -> "Bitter Sweet Symphony". Only strips release-housekeeping suffixes. */
export function cleanTrackTitle(name: string): string {
  return name
    .replace(/\s+[-–]\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|mono|stereo|single version|album version|radio edit)\b.*$/i, "")
    .replace(/\s*\((?:[^)]*remaster[^)]*|mono|stereo)\)\s*$/i, "")
    .trim() || name;
}
