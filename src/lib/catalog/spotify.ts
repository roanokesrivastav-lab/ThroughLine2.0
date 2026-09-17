import "server-only";
import { fetchWithTimeout, type CatalogAdapter, type CatalogResult } from "./types";
import { cleanTrackTitle } from "./match";

// Spotify, app-only (client credentials): identity, artwork, album and length for songs.
// Server-side only; the secret never leaves this module. Spotify's popularity field is never
// read or stored (PRD §2.4), and it offers new apps no audio features, so it describes a song
// and nothing more.

type Track = {
  id: string; name: string; duration_ms?: number;
  artists: Array<{ id: string; name: string }>;
  album: { id: string; name: string; album_type?: string; release_date?: string; images?: Array<{ url: string; width?: number | null }> };
};

const creds = () => {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim(), secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
};

let token: { value: string; expires: number } | null = null;
async function accessToken(signal?: AbortSignal): Promise<string> {
  if (token && token.expires > Date.now() + 30_000) return token.value;
  const c = creds();
  if (!c) throw new Error("Spotify not configured");
  const res = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}` },
    body: "grant_type=client_credentials",
  }, 6000, signal);
  if (!res.ok) throw new Error(`Spotify token ${res.status}`);
  const d = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: d.access_token, expires: Date.now() + d.expires_in * 1000 };
  return token.value;
}

const ALBUM_RANK: Record<string, number> = { album: 0, single: 1, compilation: 2 };

async function searchTracks(q: string, signal?: AbortSignal): Promise<CatalogResult[]> {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "10"); // the maximum Spotify accepts for this kind of app
  url.searchParams.set("q", q);
  const res = await fetchWithTimeout(url.toString(), { headers: { authorization: `Bearer ${await accessToken(signal)}` } }, 6000, signal);
  if (res.status === 401) token = null;
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  const data = (await res.json()) as { tracks?: { items: Track[] } };
  const items = data.tracks?.items ?? [];

  // Collapse remasters and re-releases of the same song by the same artist. Keep the first hit's
  // position (Spotify's own relevance order), but prefer the original album over a compilation.
  const groups = new Map<string, Track[]>();
  for (const t of items) {
    const k = `${cleanTrackTitle(t.name).toLowerCase()}::${(t.artists[0]?.name ?? "").toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()].map((group) => {
    const t = [...group].sort((a, b) => (ALBUM_RANK[a.album.album_type ?? ""] ?? 3) - (ALBUM_RANK[b.album.album_type ?? ""] ?? 3))[0];
    const artist = t.artists.map((a) => a.name).join(", ") || null;
    const image = [...(t.album.images ?? [])].sort((a, b) => Math.abs((a.width ?? 0) - 300) - Math.abs((b.width ?? 0) - 300))[0]?.url ?? null;
    const year = t.album.release_date?.slice(0, 4);
    return {
      category: "music", title: cleanTrackTitle(t.name), subtitle: artist, source: "spotify", external_id: t.id,
      image_url: image, release_year: year ? Number(year) : null,
      creators: t.artists[0] ? [{ name: t.artists[0].name, role: "artist" }] : [],
      genre_tags: [],
      metadata: { duration_seconds: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined, album: t.album.album_type === "single" ? undefined : t.album.name },
    } satisfies CatalogResult;
  });
}

export const spotifyAdapter: CatalogAdapter = {
  source: "spotify",
  categories: ["music"],
  available: () => !!creds(),
  search: (query, _category, signal) => searchTracks(query, signal),
  byCreator: (name, _category, signal) => searchTracks(`artist:"${name.replace(/"/g, "")}"`, signal),
};
