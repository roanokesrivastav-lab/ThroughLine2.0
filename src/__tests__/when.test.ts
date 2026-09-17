import { describe, expect, it } from "vitest";
import { entrySpan, lifeStageWhen, rangeWhen, seasonOf, seasonWhen, spanDays, spanOf, yearWhen, PHASE_MAX_SPAN_DAYS } from "@/lib/taste/when";
import { cleanTrackTitle, rankAcrossCategories, titleMatch } from "@/lib/catalog/match";
import { detectPhases } from "@/lib/taste/phases";
import { buildEvolution } from "@/lib/taste/evolution";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";

describe("approximate dates", () => {
  it("keeps a year a year, and labels it as approximate", () => {
    const s = spanOf(yearWhen(2019))!;
    expect(s.label).toBe("~2019");
    expect(s.start.toISOString().slice(0, 10)).toBe("2019-01-01");
    expect(s.end.toISOString().slice(0, 10)).toBe("2019-12-31");
    expect(spanDays(s)).toBeGreaterThan(PHASE_MAX_SPAN_DAYS);
  });

  it("puts December in the next winter and labels seasons by that year", () => {
    expect(seasonOf(new Date("2020-12-10T00:00:00Z"))).toEqual({ season: "winter", year: 2021 });
    const w = seasonWhen(2021, "winter");
    expect(w.consumed_at).toBe("2020-12-01");
    expect(w.consumed_until).toBe("2021-02-28");
    expect(spanOf(w)!.label).toBe("Winter 2021");
    expect(spanOf(seasonWhen(2024, "winter"))!.end.getUTCDate()).toBe(29); // leap year
    expect(spanDays(spanOf(seasonWhen(2021, "summer"))!)).toBeLessThanOrEqual(PHASE_MAX_SPAN_DAYS);
  });

  it("orders ranges and collapses a one-year range to a year", () => {
    expect(rangeWhen(2016, 2012)).toMatchObject({ consumed_at: "2012-01-01", consumed_until: "2016-12-31", consumed_precision: "range" });
    expect(spanOf(rangeWhen(2012, 2016))!.label).toBe("~2012–2016");
    expect(rangeWhen(2018, 2018).consumed_precision).toBe("year");
  });

  it("turns 'as a teen' into years from a birth year", () => {
    expect(lifeStageWhen("teen", 2000)).toMatchObject({ consumed_at: "2013-01-01", consumed_until: "2019-12-31" });
  });

  it("leaves undated onboarding picks undated, but dates ordinary logs by when they were logged", () => {
    const base = { consumed_at: null, consumed_until: null, consumed_precision: null, created_at: "2026-09-12T10:00:00Z" };
    expect(entrySpan({ ...base, origin: "onboarding_pick" })).toBeNull();
    expect(entrySpan({ ...base, origin: "canon" })).toBeNull();
    expect(entrySpan({ ...base, origin: "log" })!.label).toBe("Sep 2026");
    expect(entrySpan({ ...base, ...yearWhen(2015), origin: "onboarding_pick" })!.label).toBe("~2015");
  });
});

describe("engines skip dates they cannot honestly place", () => {
  const NOW = Date.UTC(2026, 8, 10);

  it("detects no time-window phases from undated or year-only entries", () => {
    const lib = buildFixtureLibrary(NOW);
    expect(detectPhases(lib).length).toBeGreaterThan(0);
    const undated = lib.map((e) => ({ ...e, entry: { ...e.entry, origin: "onboarding_pick" as const, consumed_at: null, consumed_until: null, consumed_precision: null } }));
    expect(detectPhases(undated).filter((p) => p.kind !== "album")).toEqual([]);
    const yearOnly = lib.map((e) => ({ ...e, entry: { ...e.entry, ...yearWhen(2020) } }));
    expect(detectPhases(yearOnly).filter((p) => p.kind !== "album")).toEqual([]);
  });

  it("leaves undated entries out of taste evolution periods", () => {
    const lib = buildFixtureLibrary(NOW);
    const undated = lib.map((e) => ({ ...e, entry: { ...e.entry, origin: "canon" as const, consumed_at: null, consumed_until: null, consumed_precision: null } }));
    expect(buildEvolution(undated, []).periods).toEqual([]);
  });
});

describe("search text helpers", () => {
  it("ranks exact over prefix over contains, ignoring case and punctuation", () => {
    expect(titleMatch("spider-man", "Spider-Man")).toBe(3);
    expect(titleMatch("hunter x hunter", "Hunter × Hunter")).toBe(3);
    expect(titleMatch("across the spider", "Spider-Man: Across the Spider-Verse")).toBe(1);
    expect(titleMatch("lord of the mysteries", "Lord of Mysteries")).toBe(3);
    expect(titleMatch("frieren", "Parasite")).toBe(0);
  });

  it("puts the film above soundtrack cuts and drops non-matching noise in an everything search", () => {
    const movie = [{ title: "Spider-Man: Across the Spider-Verse" }, { title: "Spider-Man: Across the Spider-Verse - Creating the Ultimate Spider-Man Movie" }];
    const book = [{ title: "Whose Body?" }];
    const music = [{ title: "Across the Spider-Verse (Start a Band)" }, { title: "Across the Spider-Verse (Intro)" }];
    const ranked = rankAcrossCategories("across the spider", [movie, [], [], book, music]).map((r) => r.title);
    expect(ranked[0]).toBe("Spider-Man: Across the Spider-Verse");
    expect(ranked).not.toContain("Whose Body?");
  });

  it("strips remaster housekeeping from song titles but keeps real subtitles", () => {
    expect(cleanTrackTitle("Bitter Sweet Symphony - Remastered 2016")).toBe("Bitter Sweet Symphony");
    expect(cleanTrackTitle("Heroes (2017 Remaster)")).toBe("Heroes");
    expect(cleanTrackTitle("Bittersweet Symphony (with Johnny Cosmic)")).toBe("Bittersweet Symphony (with Johnny Cosmic)");
    expect(cleanTrackTitle("Re: Stacks")).toBe("Re: Stacks");
  });
});
