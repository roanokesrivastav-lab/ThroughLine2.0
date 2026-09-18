import { describe, expect, it } from "vitest";
import { band, minutesToFinish } from "@/lib/taste/form";
import type { MediaItem } from "@/lib/types";

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: "x", category: "movie", title: "X", subtitle: null, source: "test", external_id: "x",
  image_url: null, release_year: null, creators: [], genre_tags: [], metadata: {}, feel_prior: null,
  ...over,
});

describe("minutesToFinish (SPEC §1.4, test matrix #13)", () => {
  it("movie: runtime_minutes, null when missing", () => {
    expect(minutesToFinish(item({ category: "movie", metadata: { runtime_minutes: 108 } }))).toBe(108);
    expect(minutesToFinish(item({ category: "movie" }))).toBeNull();
  });

  it("tv: episodes × episode_runtime_minutes, null when either is missing", () => {
    expect(minutesToFinish(item({ category: "tv", metadata: { episodes: 10, episode_runtime_minutes: 48 } }))).toBe(480);
    expect(minutesToFinish(item({ category: "tv", metadata: { episodes: 10 } }))).toBeNull();
    expect(minutesToFinish(item({ category: "tv", metadata: { episode_runtime_minutes: 48 } }))).toBeNull();
  });

  it("anime film (runtime, no episode runtime) takes the film value; a series multiplies", () => {
    expect(minutesToFinish(item({ category: "anime", metadata: { runtime_minutes: 120 } }))).toBe(120);
    expect(minutesToFinish(item({ category: "anime", metadata: { episodes: 148, episode_runtime_minutes: 23 } }))).toBe(3404);
    expect(minutesToFinish(item({ category: "anime", metadata: {} }))).toBeNull();
  });

  it("book: pages × 1.6, null when pages are missing", () => {
    expect(minutesToFinish(item({ category: "book", metadata: { pages: 260 } }))).toBe(416);
    expect(minutesToFinish(item({ category: "book" }))).toBeNull();
  });

  it("music is not specified in Stage 3: null, no invented behaviour", () => {
    expect(minutesToFinish(item({ category: "music", metadata: { duration_seconds: 240 } }))).toBeNull();
  });
});

describe("band (SPEC §1.4)", () => {
  it("movie boundaries: 89/90, 119/120, 149/150", () => {
    expect(band("movie", 89)).toBe(0);
    expect(band("movie", 90)).toBe(1);
    expect(band("movie", 119)).toBe(1);
    expect(band("movie", 120)).toBe(2);
    expect(band("movie", 149)).toBe(2);
    expect(band("movie", 150)).toBe(3);
  });

  it("tv and anime boundaries: 299/300, 899/900, 2399/2400", () => {
    for (const c of ["tv", "anime"] as const) {
      expect(band(c, 299)).toBe(0);
      expect(band(c, 300)).toBe(1);
      expect(band(c, 899)).toBe(1);
      expect(band(c, 900)).toBe(2);
      expect(band(c, 2399)).toBe(2);
      expect(band(c, 2400)).toBe(3);
    }
  });

  it("book boundaries: 299/300, 599/600, 1199/1200", () => {
    expect(band("book", 299)).toBe(0);
    expect(band("book", 300)).toBe(1);
    expect(band("book", 599)).toBe(1);
    expect(band("book", 600)).toBe(2);
    expect(band("book", 1199)).toBe(2);
    expect(band("book", 1200)).toBe(3);
  });

  it("unknown minutes → null for every category (missing information, never band 0)", () => {
    for (const c of ["movie", "tv", "anime", "book", "music"] as const) {
      expect(band(c, null)).toBeNull();
    }
  });
});
