import type { AttributeVector, Category, Creator, MediaMetadata } from "@/lib/types";

/** A search hit from any provider, normalised into the shared model before it becomes a media_items row. */
export type CatalogResult = {
  category: Category;
  title: string;
  subtitle: string | null;
  source: string;
  external_id: string;
  image_url: string | null;
  release_year: number | null;
  creators: Creator[];
  genre_tags: string[];
  metadata: MediaMetadata;
  feel_prior?: AttributeVector | null;
};

export interface CatalogAdapter {
  readonly source: string;
  readonly categories: readonly Category[];
  /** True when the adapter can be used in this environment (keys present, etc.). */
  available(): boolean;
  search(query: string, category: Category, signal?: AbortSignal): Promise<CatalogResult[]>;
  /** Fills in details (runtime, pages, creators) for a chosen result. May return the same object. */
  enrich?(result: CatalogResult, signal?: AbortSignal): Promise<CatalogResult>;
  /** Other works by a creator the user loved (structural bridge for recommendations). */
  byCreator?(name: string, category: Category, signal?: AbortSignal): Promise<CatalogResult[]>;
  /** Hidden-by-default external score. Only fetched when the user explicitly taps to reveal. */
  externalScore?(externalId: string, category: Category): Promise<{ label: string; value: string } | null>;
}

export function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 6000, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  signal?.addEventListener("abort", () => controller.abort());
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
