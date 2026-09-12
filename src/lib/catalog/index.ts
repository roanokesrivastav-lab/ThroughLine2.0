import "server-only";
import type { Category } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { canonAdapter } from "./canon";
import { musicBrainzAdapter } from "./musicbrainz";
import { openLibraryAdapter } from "./openlibrary";
import { tmdbAdapter } from "./tmdb";
import type { CatalogAdapter, CatalogResult } from "./types";

const REMOTE: CatalogAdapter[] = [tmdbAdapter, openLibraryAdapter, musicBrainzAdapter];

export function adapterFor(category: Category): CatalogAdapter {
  return REMOTE.find((a) => a.categories.includes(category) && a.available()) ?? canonAdapter;
}
export function adapterBySource(source: string): CatalogAdapter | null {
  return [...REMOTE, canonAdapter].find((a) => a.source === source) ?? null;
}

export type SearchResponse = { results: CatalogResult[]; degraded: Category[] };

/** Search one category or all five. Remote failures degrade to the local canon rather than erroring. */
export async function searchCatalog(query: string, category: Category | "all", signal?: AbortSignal): Promise<SearchResponse> {
  const cats = category === "all" ? [...CATEGORIES] : [category];
  const degraded: Category[] = [];
  const perCat = await Promise.all(cats.map(async (cat) => {
    const adapter = adapterFor(cat);
    try {
      const results = await adapter.search(query, cat, signal);
      if (adapter.source !== "canon" && results.length === 0) {
        // Still show a local match if the remote catalogue found nothing.
        return canonAdapter.search(query, cat);
      }
      return results;
    } catch (err) {
      console.warn(`[catalog] ${adapter.source} failed for ${cat}:`, (err as Error).message);
      degraded.push(cat);
      return canonAdapter.search(query, cat);
    }
  }));
  // Interleave categories so "all" search feels cross-media, not grouped.
  const results: CatalogResult[] = [];
  const max = Math.max(...perCat.map((r) => r.length), 0);
  for (let i = 0; i < max; i++) for (const list of perCat) if (list[i]) results.push(list[i]);
  return { results: results.slice(0, category === "all" ? 20 : 10), degraded };
}
