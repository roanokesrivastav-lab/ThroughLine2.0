import "server-only";
import type { Category } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { canonAdapter } from "./canon";
import { musicBrainzAdapter } from "./musicbrainz";
import { openLibraryAdapter } from "./openlibrary";
import { spotifyAdapter } from "./spotify";
import { rankAcrossCategories } from "./match";
import { tmdbAdapter } from "./tmdb";
import type { CatalogAdapter, CatalogResult } from "./types";

// Order matters: the first available adapter for a category is tried first, then the next.
const REMOTE: CatalogAdapter[] = [tmdbAdapter, openLibraryAdapter, spotifyAdapter, musicBrainzAdapter];

export function adapterFor(category: Category): CatalogAdapter {
  return adaptersFor(category)[0];
}
/** Every usable adapter for a category, best first, always ending with the local canon. */
export function adaptersFor(category: Category): CatalogAdapter[] {
  return [...REMOTE.filter((a) => a.categories.includes(category) && a.available()), canonAdapter];
}
export function adapterBySource(source: string): CatalogAdapter | null {
  return [...REMOTE, canonAdapter].find((a) => a.source === source) ?? null;
}

export type SearchResponse = { results: CatalogResult[]; degraded: Category[] };

/** Try each adapter for a category in order until one returns something. */
async function searchCategory(query: string, cat: Category, degraded: Category[], signal?: AbortSignal): Promise<CatalogResult[]> {
  for (const adapter of adaptersFor(cat)) {
    try {
      const results = await adapter.search(query, cat, signal);
      if (results.length) return results;
    } catch (err) {
      console.warn(`[catalog] ${adapter.source} failed for ${cat}:`, (err as Error).message);
      if (!degraded.includes(cat)) degraded.push(cat);
    }
  }
  return [];
}

/** Search one category or all five. Remote failures fall through to the next adapter, and finally the canon. */
export async function searchCatalog(query: string, category: Category | "all", signal?: AbortSignal): Promise<SearchResponse> {
  const degraded: Category[] = [];
  if (category !== "all") {
    return { results: dedupe(await searchCategory(query, category, degraded, signal)).slice(0, 20), degraded };
  }
  const perCat = await Promise.all(CATEGORIES.map((cat) => searchCategory(query, cat, degraded, signal)));
  const ranked = rankAcrossCategories(query, perCat);
  return { results: dedupe(ranked).slice(0, 12), degraded };
}

/** TMDB can return one animated film under both "movie" and "anime"; keep the first. */
function dedupe(results: CatalogResult[]): CatalogResult[] {
  const seen = new Set<string>();
  return results.filter((r) => { const k = `${r.source}:${r.external_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
