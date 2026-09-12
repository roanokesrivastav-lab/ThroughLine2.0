import { fetchWithTimeout, type CatalogAdapter, type CatalogResult } from "./types";

// MusicBrainz: free, no key, strict rate limit (1 req/s) and a required identifying User-Agent.
type Recording = {
  id: string; title: string; length?: number;
  "artist-credit"?: Array<{ name: string; artist?: { id: string; name: string } }>;
  releases?: Array<{ id: string; title: string; date?: string; "release-group"?: { "primary-type"?: string; "secondary-types"?: string[] } }>;
  tags?: Array<{ name: string; count: number }>;
  "first-release-date"?: string;
};

let lastCall = 0;
async function throttle() {
  const wait = Math.max(0, lastCall + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export const musicBrainzAdapter: CatalogAdapter = {
  source: "musicbrainz",
  categories: ["music"],
  available: () => true,
  async byCreator(name, category, signal) {
    return this.search(`artist:"${name.replace(/"/g, "")}"`, category, signal);
  },
  async search(query, _category, signal) {
    await throttle();
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "12");
    url.searchParams.set("fmt", "json");
    const res = await fetchWithTimeout(url.toString(), { headers: { accept: "application/json", "user-agent": process.env.MUSICBRAINZ_USER_AGENT ?? "Throughline/0.1 (https://github.com/throughline)" } }, 8000, signal);
    if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
    const data = (await res.json()) as { recordings: Recording[] };
    // Collapse duplicate recordings of the same song by the same artist; prefer ones attached to an album.
    const seen = new Set<string>();
    const out: CatalogResult[] = [];
    for (const r of data.recordings) {
      const artist = r["artist-credit"]?.map((a) => a.name).join("") ?? null;
      const k = `${r.title.toLowerCase()}::${(artist ?? "").toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const album = r.releases?.find((x) => x["release-group"]?.["primary-type"] === "Album" && !(x["release-group"]?.["secondary-types"]?.length)) ?? r.releases?.[0];
      const year = (album?.date ?? r["first-release-date"])?.slice(0, 4);
      out.push({
        category: "music", title: r.title, subtitle: artist, source: "musicbrainz", external_id: r.id,
        image_url: album ? `https://coverartarchive.org/release/${album.id}/front-250` : null,
        release_year: year ? Number(year) : null,
        creators: artist ? [{ name: artist, role: "artist" }] : [],
        genre_tags: (r.tags ?? []).sort((a, b) => b.count - a.count).slice(0, 4).map((t) => t.name),
        metadata: { duration_seconds: r.length ? Math.round(r.length / 1000) : undefined, album: album?.title },
      });
      if (out.length >= 8) break;
    }
    return out;
  },
};
