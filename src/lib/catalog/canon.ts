import type { AttributeVector, Category, ItemProfile } from "@/lib/types";
import { CANON, type CanonItem } from "./canon-data";
import { CANON_PROFILES } from "./canon-profiles";
import type { CatalogAdapter, CatalogResult } from "./types";

/** The committed NVIDIA-written profile for a canon slug, or null when none exists. */
export function canonProfile(slug: string): ItemProfile | null {
  return CANON_PROFILES[slug] ?? null;
}

const ROLE: Record<Category, string> = { movie: "director", tv: "creator", anime: "creator", book: "author", music: "artist" };

export function canonToResult(c: CanonItem): CatalogResult {
  const feel: AttributeVector = {};
  for (const [k, w] of c.feel) feel[k] = w;
  return {
    category: c.category, title: c.title, subtitle: c.subtitle, source: "canon", external_id: c.slug,
    image_url: null, release_year: c.year,
    creators: [{ name: c.subtitle, role: ROLE[c.category] }],
    genre_tags: c.genres,
    metadata: { ...c.meta, encounter_weight: c.encounter },
    feel_prior: feel,
  };
}

/** Lowercase, strip diacritics and punctuation, collapse spaces. Exported for Session 7's title dedupe (§5). */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Local, key-free fallback catalog. Also used as the onboarding canon. */
export const canonAdapter: CatalogAdapter = {
  source: "canon",
  categories: ["movie", "tv", "anime", "book", "music"],
  available: () => true,
  async search(query, category) {
    const q = norm(query);
    if (!q) return [];
    const terms = q.split(" ");
    return CANON.filter((c) => c.category === category)
      .map((c) => {
        const hay = norm(`${c.title} ${c.subtitle}`);
        const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) + (hay.startsWith(q) ? 2 : 0);
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => canonToResult(x.c));
  },
};

/** Onboarding deck: spread across categories, biased by encounter likelihood, excluding what the user already has. */
export function canonDeck(excludeSlugs: Set<string>, size = 25, seed = 1): CatalogResult[] {
  // Deterministic shuffle by seed so a resumed session shows the same deck.
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
  const byCat = new Map<Category, CanonItem[]>();
  for (const c of CANON) {
    if (excludeSlugs.has(c.slug)) continue;
    byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  }
  for (const [cat, list] of byCat) {
    byCat.set(cat, list.map((c) => ({ c, key: c.encounter + rnd() * 0.5 })).sort((a, b) => b.key - a.key).map((x) => x.c));
  }
  const out: CanonItem[] = [];
  const cats: Category[] = ["movie", "tv", "book", "music", "anime"];
  let i = 0;
  while (out.length < size) {
    let took = false;
    for (const cat of cats) {
      const list = byCat.get(cat) ?? [];
      if (list[i]) { out.push(list[i]); took = true; }
      if (out.length >= size) break;
    }
    if (!took) break;
    i++;
  }
  return out.map(canonToResult);
}
