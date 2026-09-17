import { describe, expect, it } from "vitest";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { buildTagProfile } from "@/lib/taste/tags";
import { feelingWeight, scoreCandidates, ROUTE_LABEL, type Candidate } from "@/lib/taste/recommend";
import { CANON } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import type { EntryWithContext, MediaItem } from "@/lib/types";

const NOW = Date.UTC(2026, 8, 10);
const lib = buildFixtureLibrary(NOW);

function canonCandidates(source: EntryWithContext[] = lib): Candidate[] {
  const inLib = new Set(source.map((e) => e.item.external_id));
  const titles = new Set(source.map((e) => e.item.title.toLowerCase()));
  return CANON.filter((c) => !inLib.has(c.slug) && !titles.has(c.title.toLowerCase())).map((c) => {
    const r = canonToResult(c);
    return { item: { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null }, vector: r.feel_prior ?? null };
  });
}

/** The onboarding case: canon taps only, nothing written. */
const cold: EntryWithContext[] = lib.slice(0, 10).map((e) => ({
  ...e,
  entry: { ...e.entry, private_score: null, origin: "canon" as const },
  reactions: e.reactions.map((r) => ({ ...r, raw_note: null, dimensions: { loved: true } })),
  extractions: [],
}));

describe("the feeling / rules balance", () => {
  it("leads with tags when nothing has been written and with feeling once it has", () => {
    expect(feelingWeight(0)).toBeCloseTo(0.15, 2);
    expect(feelingWeight(12)).toBeCloseTo(0.8, 2);
    expect(feelingWeight(100)).toBeCloseTo(0.8, 2); // capped, never total
    expect(feelingWeight(6)).toBeGreaterThan(feelingWeight(3));
  });

  it("rises only with written notes, not with entry count", () => {
    const noNotes = buildTagProfile(cold);
    const withNotes = buildTagProfile(lib);
    expect(noNotes.evidence.notes).toBe(0);
    expect(withNotes.evidence.notes).toBeGreaterThan(10);
    expect(feelingWeight(withNotes.evidence.notes)).toBeGreaterThan(feelingWeight(noNotes.evidence.notes));
  });
});

describe("cold start", () => {
  const recs = scoreCandidates(cold, canonCandidates(cold), { limit: 5 }, "u1");

  it("still produces a full set of explained picks with no notes at all", () => {
    expect(recs.length).toBe(5);
    for (const r of recs) {
      expect(r.explanation.length).toBeGreaterThan(15);
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it("routes through tags rather than pretending to read a feeling", () => {
    expect(recs.filter((r) => r.route === "tag_overlap").length).toBeGreaterThanOrEqual(3);
    for (const r of recs.filter((r) => r.route === "tag_overlap")) {
      expect(r.breakdown.matchedTags.length).toBeGreaterThan(0);
      expect(r.explanation).toMatch(/keep coming back to/i);
    }
  });

  it("scores a candidate the feeling layer cannot read at all, rather than dropping it", () => {
    const blind: Candidate[] = [{ item: bare("no-vector", ["comedy"]), vector: null }];
    const [r] = scoreCandidates(cold, blind, { limit: 5 }, "u1");
    expect(r).toBeDefined();
    expect(r.score).toBeGreaterThan(0);
    expect(r.breakdown.components.find((c) => c.key === "feeling")!.value).toBeNull();
  });
});

describe("scoring mechanics", () => {
  const profile = buildTagProfile(lib);
  const recs = scoreCandidates(lib, canonCandidates(), { limit: 5 }, "u1", profile);

  it("declares a route that matches the explanation it produced", () => {
    for (const r of recs) {
      expect(ROUTE_LABEL[r.route]).toBeTruthy();
      if (r.route === "feeling") expect(r.explanation).toMatch(/connects to something you loved|close to the centre/i);
      if (r.route === "tag_overlap") expect(r.explanation).toMatch(/keep coming back to/i);
      if (r.route === "creator") expect(r.explanation).toMatch(/same hands/i);
      if (r.route === "backlog") expect(r.explanation).toMatch(/from your own list/i);
    }
  });

  it("re-normalises so a candidate without a feeling vector is not structurally punished", () => {
    const tagged = bare("tagged", ["indie folk", "folk"]);
    const withFeel: Candidate = { item: tagged, vector: { "theme.grief": 0.9, "register.quiet": 0.8 } };
    const withoutFeel: Candidate = { item: { ...tagged, id: "canon:tagged-2", external_id: "tagged-2" }, vector: null };
    const [a, b] = [
      scoreCandidates(lib, [withFeel], { limit: 1 }, "u1", profile)[0],
      scoreCandidates(lib, [withoutFeel], { limit: 1 }, "u1", profile)[0],
    ];
    // The one with no feeling evidence still scores on its own terms, close to
    // the other rather than a fraction of it.
    expect(b.score).toBeGreaterThan(a.score * 0.5);
    expect(b.breakdown.normalisedWeight).toBeLessThan(a.breakdown.normalisedWeight);
  });

  it("keeps the total equal to the arithmetic it displays", () => {
    for (const r of recs) {
      const blend = r.breakdown.components.reduce((n, c) => n + c.contribution, 0) / r.breakdown.normalisedWeight;
      const adjust = r.breakdown.adjustments.reduce((n, a) => n + a.delta, 0);
      expect(blend + adjust).toBeCloseTo(r.score, 6);
      expect(r.breakdown.total).toBeCloseTo(r.score, 6);
    }
  });

  it("keeps the private score a nudge and nothing more", () => {
    for (const r of recs) expect(Math.abs(r.breakdown.score_hint)).toBeLessThan(0.06);
  });

  it("never returns more than two things by the same maker", () => {
    const perMaker = new Map<string, number>();
    for (const r of scoreCandidates(lib, canonCandidates(), { limit: 5 }, "u1", profile)) {
      const k = (r.breakdown.creator?.name ?? r.item.subtitle ?? "none").toLowerCase();
      perMaker.set(k, (perMaker.get(k) ?? 0) + 1);
    }
    for (const [maker, n] of perMaker) if (maker !== "none") expect(n).toBeLessThanOrEqual(2);
  });

  it("treats a dismissed candidate and a muted kind as filters, not penalties", () => {
    const cand = canonCandidates();
    const target = cand[0];
    const hidden = buildTagProfile(lib, { pinned: [], muted: [], hidden: [target.item.id] });
    expect(scoreCandidates(lib, [target], { limit: 5 }, "u1", hidden)).toHaveLength(0);

    const muteTag = target.item.genre_tags[0];
    if (muteTag) {
      const muted = buildTagProfile(lib, { pinned: [], muted: [muteTag], hidden: [] });
      expect(scoreCandidates(lib, [target], { limit: 5 }, "u1", muted)).toHaveLength(0);
    }
  });

  it("is deterministic", () => {
    const a = scoreCandidates(lib, canonCandidates(), { limit: 5 }, "u1", profile).map((r) => r.item.id);
    const b = scoreCandidates(lib, canonCandidates(), { limit: 5 }, "u1", profile).map((r) => r.item.id);
    expect(a).toEqual(b);
  });
});

describe("the creator route", () => {
  it("fires and says whose hands they are, when the maker is someone they return to", () => {
    const profile = buildTagProfile(lib);
    const ishiguro = [...profile.creators.values()].find((c) => c.name.includes("Ishiguro"))!;
    expect(ishiguro.weight).toBeGreaterThan(0.5);

    const another: MediaItem = {
      ...bare("another-ishiguro", []),
      category: "book",
      title: "An Artist of the Floating World",
      subtitle: ishiguro.name,
      creators: [{ name: ishiguro.name, role: "author" }],
      metadata: { pages: 206 },
    };
    const [r] = scoreCandidates(lib, [{ item: another, vector: null }], { limit: 1 }, "u1", profile);
    expect(r.route).toBe("creator");
    expect(r.explanation).toMatch(/Same hands as something you loved: Kazuo Ishiguro/);
    expect(r.breakdown.creator?.entryIds.length).toBeGreaterThanOrEqual(2);
  });
});

function bare(id: string, genres: string[]): MediaItem {
  return {
    id: `canon:${id}`, category: "movie", title: `Title ${id}`, subtitle: `Maker ${id}`,
    source: "canon", external_id: id, image_url: null, release_year: 2020,
    creators: [{ name: `Maker ${id}`, role: "director" }], genre_tags: genres,
    metadata: { runtime_minutes: 100 }, feel_prior: null,
  };
}

describe("regressions", () => {
  const profile = buildTagProfile(lib);

  it("treats an anime feature as a film for time budgets, not as one episode", () => {
    const feature: MediaItem = { ...bare("anime-feature", ["animation", "drama"]), category: "anime", metadata: { runtime_minutes: 125 } };
    expect(scoreCandidates(lib, [{ item: feature, vector: null }], { minutes: 40, limit: 1 }, "u1", profile)).toHaveLength(0);
    const [r] = scoreCandidates(lib, [{ item: feature, vector: null }], { minutes: 150, limit: 1 }, "u1", profile);
    expect(r.fits).toBe("125 min");
  });

  it("breaks score ties by candidate key, whatever order the candidates arrived in", () => {
    const a: Candidate = { item: bare("tie-a", ["thriller"]), vector: null };
    const b: Candidate = { item: bare("tie-b", ["thriller"]), vector: null };
    const forward = scoreCandidates(lib, [a, b], { limit: 2 }, "u1", profile);
    const reversed = scoreCandidates(lib, [b, a], { limit: 2 }, "u1", profile);
    expect(forward[0].score).toBe(forward[1].score);
    expect(forward.map((r) => r.item.id)).toEqual(reversed.map((r) => r.item.id));
  });
});
