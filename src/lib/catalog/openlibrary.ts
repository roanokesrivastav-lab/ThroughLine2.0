import { fetchWithTimeout, type CatalogAdapter, type CatalogResult } from "./types";

type Doc = { key: string; title: string; author_name?: string[]; first_publish_year?: number; cover_i?: number; subject?: string[]; number_of_pages_median?: number; ratings_average?: number };

const SUBJECT_MAP: Array<[RegExp, string]> = [
  [/science fiction/i, "sci-fi"], [/fantasy/i, "fantasy"], [/mystery|detective/i, "mystery"], [/horror/i, "horror"],
  [/romance/i, "romance"], [/thriller|suspense/i, "thriller"], [/memoir|autobiograph/i, "memoir"], [/biograph/i, "biography"],
  [/poetry|poems/i, "poetry"], [/history/i, "history"], [/philosophy/i, "philosophy"], [/essays/i, "essays"],
  [/short stories/i, "short stories"], [/coming of age|bildungsroman/i, "coming-of-age"], [/war/i, "war"], [/crime/i, "crime"],
  [/humor|humour|comic/i, "comedy"], [/literary/i, "literary"], [/nature/i, "nature"], [/grief|death/i, "grief"],
];

export const openLibraryAdapter: CatalogAdapter = {
  source: "openlibrary",
  categories: ["book"],
  available: () => true,
  async search(query, _category, signal) {
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median");
    const res = await fetchWithTimeout(url.toString(), { headers: { accept: "application/json", "user-agent": process.env.MUSICBRAINZ_USER_AGENT ?? "Throughline/0.1" } }, 7000, signal);
    if (!res.ok) throw new Error(`Open Library ${res.status}`);
    const data = (await res.json()) as { docs: Doc[] };
    return data.docs.map((d): CatalogResult => {
      const tags = new Set<string>();
      for (const s of d.subject ?? []) for (const [re, tag] of SUBJECT_MAP) if (re.test(s)) tags.add(tag);
      const author = d.author_name?.[0] ?? null;
      return {
        category: "book", title: d.title, subtitle: author, source: "openlibrary", external_id: d.key.replace("/works/", ""),
        image_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        release_year: d.first_publish_year ?? null,
        creators: author ? [{ name: author, role: "author" }] : [],
        genre_tags: [...tags].slice(0, 6),
        metadata: { pages: d.number_of_pages_median ?? undefined },
      };
    });
  },
  async byCreator(name, _category, signal) {
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("author", name);
    url.searchParams.set("limit", "8");
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median");
    const res = await fetchWithTimeout(url.toString(), { headers: { accept: "application/json" } }, 7000, signal);
    if (!res.ok) return [];
    const data = (await res.json()) as { docs: Doc[] };
    return data.docs.map((d): CatalogResult => ({
      category: "book", title: d.title, subtitle: d.author_name?.[0] ?? name, source: "openlibrary", external_id: d.key.replace("/works/", ""),
      image_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null, release_year: d.first_publish_year ?? null,
      creators: [{ name: d.author_name?.[0] ?? name, role: "author" }], genre_tags: [], metadata: { pages: d.number_of_pages_median ?? undefined },
    }));
  },
  async externalScore(externalId) {
    const res = await fetchWithTimeout(`https://openlibrary.org/works/${externalId}/ratings.json`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const d = (await res.json()) as { summary?: { average?: number | null } };
    return d.summary?.average ? { label: "Open Library average", value: d.summary.average.toFixed(1) + " / 5" } : null;
  },
};
