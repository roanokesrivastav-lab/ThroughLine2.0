import type { Category } from "@/lib/types";
import { fetchWithTimeout, type CatalogAdapter, type CatalogResult } from "./types";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";

const GENRES: Record<number, string> = {
  28: "action", 12: "adventure", 16: "animation", 35: "comedy", 80: "crime", 99: "documentary", 18: "drama",
  10751: "family", 14: "fantasy", 36: "history", 27: "horror", 10402: "music", 9648: "mystery", 10749: "romance",
  878: "sci-fi", 10770: "tv movie", 53: "thriller", 10752: "war", 37: "western",
  10759: "action & adventure", 10762: "kids", 10763: "news", 10764: "reality", 10765: "sci-fi & fantasy",
  10766: "soap", 10767: "talk", 10768: "war & politics",
};

type TmdbMovie = { id: number; title: string; release_date?: string; poster_path?: string | null; genre_ids?: number[]; original_language?: string; overview?: string; runtime?: number; credits?: { crew?: Array<{ job: string; name: string }> }; vote_average?: number };
type TmdbTv = { id: number; name: string; first_air_date?: string; poster_path?: string | null; genre_ids?: number[]; origin_country?: string[]; original_language?: string; overview?: string; episode_run_time?: number[]; number_of_episodes?: number; created_by?: Array<{ name: string }>; vote_average?: number; genres?: Array<{ id: number }> };

function key(): string | undefined { return process.env.TMDB_API_KEY; }

async function get<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", key()!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchWithTimeout(url.toString(), { headers: { accept: "application/json" } }, 6000, signal);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json() as Promise<T>;
}

const isAnimeLike = (genreIds: number[] | undefined, lang: string | undefined, origin?: string[]) =>
  (genreIds ?? []).includes(16) && (lang === "ja" || (origin ?? []).includes("JP"));

function fromMovie(m: TmdbMovie, category: Category): CatalogResult {
  return {
    category, title: m.title, subtitle: null, source: "tmdb", external_id: `movie:${m.id}`,
    image_url: m.poster_path ? IMG + m.poster_path : null,
    release_year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    creators: [], genre_tags: (m.genre_ids ?? []).map((g) => GENRES[g]).filter(Boolean),
    metadata: { overview: m.overview?.slice(0, 300) },
  };
}
function fromTv(t: TmdbTv, category: Category): CatalogResult {
  return {
    category, title: t.name, subtitle: null, source: "tmdb", external_id: `tv:${t.id}`,
    image_url: t.poster_path ? IMG + t.poster_path : null,
    release_year: t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : null,
    creators: [], genre_tags: (t.genre_ids ?? []).map((g) => GENRES[g]).filter(Boolean),
    metadata: { overview: t.overview?.slice(0, 300) },
  };
}

export const tmdbAdapter: CatalogAdapter = {
  source: "tmdb",
  categories: ["movie", "tv", "anime"],
  available: () => !!key(),
  async search(query, category, signal) {
    if (category === "movie") {
      const data = await get<{ results: TmdbMovie[] }>("/search/movie", { query, include_adult: "false" }, signal);
      return data.results.slice(0, 8).map((m) => fromMovie(m, isAnimeLike(m.genre_ids, m.original_language) ? "anime" : "movie"));
    }
    if (category === "tv") {
      const data = await get<{ results: TmdbTv[] }>("/search/tv", { query, include_adult: "false" }, signal);
      return data.results.slice(0, 8).map((t) => fromTv(t, isAnimeLike(t.genre_ids, t.original_language, t.origin_country) ? "anime" : "tv"));
    }
    // anime: search both, keep animated Japanese-origin results (and animated titles as a looser fallback)
    const [tv, movies] = await Promise.all([
      get<{ results: TmdbTv[] }>("/search/tv", { query, include_adult: "false" }, signal),
      get<{ results: TmdbMovie[] }>("/search/movie", { query, include_adult: "false" }, signal),
    ]);
    const strict = [
      ...tv.results.filter((t) => isAnimeLike(t.genre_ids, t.original_language, t.origin_country)).map((t) => fromTv(t, "anime")),
      ...movies.results.filter((m) => isAnimeLike(m.genre_ids, m.original_language)).map((m) => fromMovie(m, "anime")),
    ];
    if (strict.length) return strict.slice(0, 8);
    return [
      ...tv.results.filter((t) => (t.genre_ids ?? []).includes(16)).map((t) => fromTv(t, "anime")),
      ...movies.results.filter((m) => (m.genre_ids ?? []).includes(16)).map((m) => fromMovie(m, "anime")),
    ].slice(0, 8);
  },
  async enrich(result, signal) {
    const [kind, id] = result.external_id.split(":");
    try {
      if (kind === "movie") {
        const m = await get<TmdbMovie>(`/movie/${id}`, { append_to_response: "credits" }, signal);
        const director = m.credits?.crew?.find((c) => c.job === "Director")?.name;
        return { ...result, subtitle: director ?? result.subtitle, creators: director ? [{ name: director, role: "director" }] : [], metadata: { ...result.metadata, runtime_minutes: m.runtime || undefined } };
      }
      const t = await get<TmdbTv>(`/tv/${id}`, {}, signal);
      const creator = t.created_by?.[0]?.name;
      return {
        ...result, subtitle: creator ?? result.subtitle, creators: creator ? [{ name: creator, role: "creator" }] : [],
        metadata: { ...result.metadata, episode_runtime_minutes: t.episode_run_time?.[0] || undefined, episodes: t.number_of_episodes || undefined },
      };
    } catch {
      return result;
    }
  },
  async byCreator(name, category, signal) {
    const people = await get<{ results: Array<{ id: number; known_for_department?: string }> }>("/search/person", { query: name }, signal);
    const person = people.results[0];
    if (!person) return [];
    if (category === "movie") {
      const credits = await get<{ crew: TmdbMovie[] & Array<{ job?: string }> }>(`/person/${person.id}/movie_credits`, {}, signal);
      return credits.crew.filter((c) => (c as { job?: string }).job === "Director").slice(0, 8).map((m) => ({ ...fromMovie(m, "movie"), subtitle: name, creators: [{ name, role: "director" }] }));
    }
    const credits = await get<{ crew: TmdbTv[] & Array<{ job?: string }> }>(`/person/${person.id}/tv_credits`, {}, signal);
    return credits.crew.filter((c) => /creator|executive producer|writer/i.test((c as { job?: string }).job ?? "")).slice(0, 8).map((t) => ({ ...fromTv(t, category), subtitle: name, creators: [{ name, role: "creator" }] }));
  },
  async externalScore(externalId) {
    const [kind, id] = externalId.split(":");
    const d = await get<{ vote_average?: number }>(`/${kind}/${id}`, {});
    return d.vote_average ? { label: "TMDB average", value: d.vote_average.toFixed(1) + " / 10" } : null;
  },
};
