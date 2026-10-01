// Session 8 tests for the eval harness (SPEC §D; handoff §3 tests A–H).
// Offline and deterministic: fixed NOW, committed canon profiles, no db/network/model.
import { describe, expect, it } from "vitest";

import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { cal, calibrate } from "@/lib/taste/calibration";
import { explainScore, leaveOneLovedOut, lovedWithProfile, temporalHoldout, componentSpread, coldStart, coldStartLibrary, diversityRun } from "@/lib/taste/eval";
import { filterCandidates, type PipelineFilters } from "@/lib/taste/filters";
import { generateCandidates } from "@/lib/taste/candidates";
import { buildUserProfile, type UserProfile } from "@/lib/taste/profile";
import { scoreCandidates, type ScoredCandidate, type StageCandidate } from "@/lib/taste/score";
import { simFamily } from "@/lib/taste/vector";
import { candidateKey, EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import { W0, type Component } from "@/lib/taste/weights";
import type { EntryWithContext, MediaItem } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z");
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;

const filters: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

/** The canon catalog as profiled items (stage-recommend.ts's construction, non-music only). */
function canonCatalog(): MediaItem[] {
  return CANON.filter((c) => c.category !== "music").map((c) => {
    const r = canonToResult(c);
    return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
  }).filter((m) => m.profile !== null);
}

const library = () => buildFixtureLibrary(NOW_MS, { profiles: "canon" });

/** Scored candidates for the default fixture request (the D-run pieces eval.ts itself uses). */
function scoredForFixture(prefs = EMPTY_TASTE_PREFS) {
  const lib = library();
  const P = buildUserProfile(lib, [], prefs, NOW);
  const { candidates } = generateCandidates({ library: lib, P, filters, canon: canonCatalog(), creatorResults: new Map(), pool: [] });
  const { kept } = filterCandidates({ candidates, library: lib, prefs, filters, recent: [], now: NOW });
  return { P, scored: scoreCandidates(P, kept).scored };
}

// ---------------------------------------------------------------------------
// A — explainScore (AUDIT §5.3)
// ---------------------------------------------------------------------------

describe("explainScore (test A, AUDIT §5.3)", () => {
  it("contributions sum to the score, calibrated values equal cal(raw), shared keys carry both sides' weights", () => {
    const { P, scored } = scoredForFixture();
    const top = [...scored].sort((a, b) => b.score - a.score)[0];
    const report = explainScore(P, top);

    // Contributions sum to the candidate's score to 1e-9.
    const sum = report.rows.reduce((a, r) => a + r.contribution, 0);
    expect(sum).toBeCloseTo(report.score, 9);
    expect(report.score).toBeCloseTo(top.score, 12);

    // The calibrated values equal cal(raw) under the committed table (§2: the blend of both halves).
    for (const k of ["story", "feeling"] as const) {
      const row = report.rows.find((r) => r.component === k)!;
      const anchor = report.anchors[k];
      expect(anchor).not.toBeNull();
      expect(row.raw).not.toBeNull();
      expect(anchor!.calibrated).toBeCloseTo(cal(anchor!.raw, report.calibration[k]), 9);
      const blend = 0.5 * cal(row.raw!.centroid, report.calibration[k]) + 0.5 * cal(row.raw!.anchor, report.calibration[k]);
      expect(row.calibrated).toBeCloseTo(Math.max(0, Math.min(1, blend)), 9);
      expect(row.weight).toBe(W0[k]);
      expect(row.contribution).toBeCloseTo(W0[k] * row.calibrated, 12);
    }

    // The shared keys carry both sides' weights: a = the candidate's vector, b = the anchor's.
    for (const k of ["story", "feeling"] as const) {
      const vec = top.candidate.item.profile?.vector[k] ?? {};
      const pick = top.anchors[k];
      for (const s of report.shared[k]) {
        expect(vec[s.key]).toBe(s.a);
        expect(pick!.anchor.vector[s.key]).toBe(s.b);
        expect(s.weight).toBeGreaterThan(0);
        expect(s.weight).toBeLessThanOrEqual(s.a * s.b + 1e-12); // weight = a·b·G with G ≤ 1
      }
    }
  });
});

// ---------------------------------------------------------------------------
// B — leave-one-loved-out (D.1)
// ---------------------------------------------------------------------------

describe("leaveOneLovedOut (test B, D.1)", () => {
  it("a holdout that near-duplicates two loved items ranks ≤ 5", () => {
    const base = canonCatalog()[0];
    const profile = structuredClone(base.profile!);
    const synth = (suffix: string): MediaItem => ({ ...base, id: `synth-${suffix}`, external_id: `synth-${suffix}`, title: `Synth ${suffix}`, profile });
    const entry = (item: MediaItem, id: string): EntryWithContext => ({
      entry: { id, user_id: "u", media_item_id: item.id, status: "completed", private_score: null, consumed_at: "2026-01-01", consumed_until: null, consumed_precision: "day", origin: "demo", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      item,
      reactions: [{ id: `r-${id}`, entry_id: id, user_id: "u", dimensions: { loved: true }, raw_note: null, source: "demo", created_at: "2026-01-01T00:00:00Z" }],
      extractions: [],
      resurfaces: [],
    });
    const lib = [entry(synth("h"), "e-h"), entry(synth("a"), "e-a"), entry(synth("b"), "e-b")];
    const report = leaveOneLovedOut({ library: lib, phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    const h = report.rows.find((r) => r.key === "canon:synth-h")!;
    expect(h.excluded).toBeNull();
    expect(h.rank).not.toBeNull();
    expect(h.rank!).toBeLessThanOrEqual(5);
  });

  it("on the fixture library the MRR is finite and n + excluded equals the loved-with-profile count", () => {
    const lib = library();
    const report = leaveOneLovedOut({ library: lib, phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    expect(Number.isFinite(report.mrr)).toBe(true);
    expect(report.n + report.excluded.length).toBe(lovedWithProfile(lib).length);
    expect(report.rows.length).toBe(lovedWithProfile(lib).length);
  });
});

// ---------------------------------------------------------------------------
// C — a filtered holdout lands in `excluded` (D.1 step 6)
// ---------------------------------------------------------------------------

describe("leaveOneLovedOut exclusion (test C, D.1)", () => {
  it("a hidden holdout is excluded with the reason and never ranked", () => {
    const lib = library();
    const loved = lovedWithProfile(lib);
    expect(loved.length).toBeGreaterThan(0);
    const h = loved[0];
    const prefs = { pinned: [], muted: [], hidden: [candidateKey(h.item)] };
    const report = leaveOneLovedOut({ library: lib, phases: [], prefs, canon: canonCatalog(), pool: [], now: NOW });
    const row = report.rows.find((r) => r.key === candidateKey(h.item))!;
    expect(row.excluded).toBe("filtered");
    expect(row.rank).toBeNull();
    expect(report.excluded).toContainEqual({ key: candidateKey(h.item), reason: "filtered" });
  });
});

// ---------------------------------------------------------------------------
// D — temporal holdout (D.2)
// ---------------------------------------------------------------------------

describe("temporalHoldout (test D, D.2)", () => {
  it("fewer than 5 holdouts → skipped", () => {
    const lib = library().slice(0, 4);
    const report = temporalHoldout({ library: lib, phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    expect(report).toEqual({ skipped: "fewer than 5 holdouts" });
  });

  it("with a synthetic dated library the split is 70/30 and undated entries stay in training", () => {
    const items = canonCatalog();
    const dated = items.slice(0, 18);
    const undatedItem = items[18];
    const entries: EntryWithContext[] = dated.map((item, i) => {
      const day = new Date(NOW.getTime() - (200 - i) * DAY).toISOString().slice(0, 10);
      return {
        entry: { id: `e-${i}`, user_id: "u", media_item_id: item.id, status: "completed", private_score: null, consumed_at: day, consumed_until: null, consumed_precision: "day", origin: "demo", created_at: `${day}T00:00:00Z`, updated_at: `${day}T00:00:00Z` },
        item,
        reactions: [{ id: `r-${i}`, entry_id: `e-${i}`, user_id: "u", dimensions: { loved: true }, raw_note: null, source: "demo", created_at: `${day}T00:00:00Z` }],
        extractions: [],
        resurfaces: [],
      };
    });
    // Undated: consumed_at null + canon origin → entrySpan null (when.ts), so it must
    // stay in training whatever its date-ish fields say.
    entries.push({
      entry: { id: "e-undated", user_id: "u", media_item_id: undatedItem.id, status: "completed", private_score: null, consumed_at: null, consumed_until: null, consumed_precision: "day", origin: "canon", created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" },
      item: undatedItem,
      reactions: [{ id: "r-undated", entry_id: "e-undated", user_id: "u", dimensions: { loved: true }, raw_note: null, source: "demo", created_at: "2020-01-01T00:00:00Z" }],
      extractions: [],
      resurfaces: [],
    });

    const report = temporalHoldout({ library: entries, phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    if (report.skipped) throw new Error(`expected a real split, got skipped: ${report.skipped}`);
    // 18 dated loved entries → floor(18·0.7) = 12 train / 6 holdouts.
    expect(report.n_holdout).toBe(6);
    // Training = the 12 earlier dated + the 1 undated entry.
    expect(report.n_train).toBe(13);
    const sortedDates = dated.map((_, i) => new Date(NOW.getTime() - (200 - i) * DAY).getTime()).sort((a, b) => a - b);
    // entryDate is the span's midpoint; day-precision spans are midnight-centered, so
    // the 70/30 boundary sits at the 13th entry's midnight, not the constructor's noon.
    expect(report.t).toBe(new Date(sortedDates[12]).toISOString().slice(0, 10) + "T00:00:00.000Z");
    expect(report.unprofiled_share).toBe(0);
  });

  it("the newest holdouts being unprofiled does not hide them from the split (review P2-1)", () => {
    // The reviewer's scenario: with 18 dated loved entries where the NEWEST six are
    // unprofiled, the split still sees all 18 (5 train / 13 holdout boundary per 70/30)
    // and the unprofiled share is measured, not zero.
    const items = canonCatalog();
    const entries: EntryWithContext[] = items.slice(0, 18).map((item, i) => {
      const day = new Date(NOW.getTime() - (200 - i) * DAY).toISOString().slice(0, 10);
      const unprofiled = i >= 12; // the six newest
      return {
        entry: { id: `e-${i}`, user_id: "u", media_item_id: item.id, status: "completed", private_score: null, consumed_at: day, consumed_until: null, consumed_precision: "day", origin: "demo", created_at: `${day}T00:00:00Z`, updated_at: `${day}T00:00:00Z` },
        item: unprofiled ? { ...item, profile: null } : item,
        reactions: [{ id: `r-${i}`, entry_id: `e-${i}`, user_id: "u", dimensions: { loved: true }, raw_note: null, source: "demo", created_at: `${day}T00:00:00Z` }],
        extractions: [],
        resurfaces: [],
      };
    });
    const report = temporalHoldout({ library: entries, phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    if (report.skipped) throw new Error(`expected a real split, got skipped: ${report.skipped}`);
    expect(report.n_holdout).toBe(6); // the newest 6, profiled or not — the old code saw 0
    expect(report.unprofiled_share).toBe(1); // every holdout in this scenario is unprofiled
    expect(report.n_train).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// E — component spread dead/dominant flags (D.3)
// ---------------------------------------------------------------------------

describe("componentSpread (test E, D.3)", () => {
  const fakeP = {
    story: { centroid: {}, anchors: [] },
    feeling: { centroid: {}, anchors: [] },
    form: {},
    creators: new Map(),
    activePhase: null,
    anti: { story: null, feeling: null },
  } as unknown as UserProfile;

  const scored = (features: Partial<Record<Component, number>>): ScoredCandidate => {
    const f = { story: 0, feeling: 0, form: 0, creator: 0, phase: 0, anti: 0, ...features } as Record<Component, number>;
    const contributions = {} as Record<Component, number>;
    let total = 0;
    for (const k of Object.keys(W0) as Component[]) {
      contributions[k] = W0[k] * f[k];
      total += contributions[k];
    }
    const candidate: StageCandidate = {
      key: "canon:x",
      item: { ...(canonCatalog()[0] as MediaItem), id: "canon:x" },
      entryId: null,
      sources: [],
      creatorKey: null,
    };
    return {
      candidate,
      features: f,
      raw: { story: null, feeling: null, anti: { story: null, feeling: null } },
      has_evidence: { story: true, feeling: true, form: false, creator: false, phase: false, anti: false },
      weights: W0,
      contributions,
      score: total,
      anchors: { story: null, feeling: null },
    };
  };

  it("a component with identical values on every candidate and evidence is dead; no evidence → not dead", () => {
    const rows = componentSpread([scored({ story: 0.8 }), scored({ story: 0.8 })], fakeP);
    expect(rows.find((r) => r.component === "story")!.dead).toBe(true);
    // phase has no evidence for this P, so a zero spread is not "dead" (§D.3 needs both).
    expect(rows.find((r) => r.component === "phase")!.dead).toBe(false);
  });

  it("a hand-built spread flags the dominant component", () => {
    const rows = componentSpread([scored({ story: 1, feeling: 0.05 }), scored({ story: 0, feeling: 0 })], fakeP);
    const story = rows.find((r) => r.component === "story")!;
    expect(story.dominant).toBe(true);
    expect(rows.filter((r) => r.dominant)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// F — cold start under the committed calibration (D.4)
// ---------------------------------------------------------------------------

describe("coldStart (test F, D.4)", () => {
  it("the pass conditions hold: five results, all explained, story evidence, no own-words feeling anchor", () => {
    const report = coldStart({ library: coldStartLibrary(library()), phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    expect(report.pass).toEqual({ five_results: true, all_explained: true, story_evidence_all: true, no_feeling_route_with_own_words_anchor: true });
    // The unfiltered request returns 5; combined with the four category runs the report
    // carries 25 rows (§D.4: one run per category, review P2-4).
    expect(report.results).toBe(25);
    expect(report.per_category.map((c) => c.category)).toEqual(["movie", "tv", "anime", "book"]);
    for (const c of report.per_category) {
      expect(c.results).toBe(5); // every canon tap is movie/tv/anime/book; music is absent
      expect(c.categories_covered).toEqual([c.category]);
    }
    expect(report.own_words_zero_share).toBe(1);
    // Reported, not thresholded (§D.4): under the committed calibration the unfiltered
    // cold-start request fills every band seat — the engine's own quota bookkeeping,
    // which is what the top-level flag mirrors. (Under the provisional clamp this read
    // false: every tap landed familiar and the familiar quota could not fill.)
    expect(report.quotas_met).toBe(true);
    // Per category the picture differs (logged, not thresholded): the movie/tv/book
    // candidate clusters sit in familiar and leave an adjacent/stretch seat unfilled.
    const byCat = Object.fromEntries(report.per_category.map((c) => [c.category, c.quotas_met]));
    expect(byCat).toEqual({ movie: false, tv: false, anime: true, book: false });
    expect(report.mean_closeness).toBeGreaterThanOrEqual(0);
    expect(report.mean_closeness).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// G — diversity run (D.5)
// ---------------------------------------------------------------------------

describe("diversityRun (test G, D.5)", () => {
  it("seven days are deterministic and the Jaccard stays in [0, 1]", () => {
    const args = { library: library(), phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW };
    const a = diversityRun(args);
    const b = diversityRun(args);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.days).toHaveLength(7);
    expect(a.mean_consecutive_jaccard).toBeGreaterThanOrEqual(0);
    expect(a.mean_consecutive_jaccard).toBeLessThanOrEqual(1);
    expect(a.max_theme_share).toBeGreaterThanOrEqual(0);
    expect(a.max_theme_share).toBeLessThanOrEqual(1);
    for (const d of a.days) expect(new Set(d.keys).size).toBe(d.keys.length);
  });

  it("with recency on, day 2 differs from day 1 when enough candidates exist", () => {
    const run = diversityRun({ library: library(), phases: [], prefs: EMPTY_TASTE_PREFS, canon: canonCatalog(), pool: [], now: NOW });
    expect(run.days[1].keys).not.toEqual(run.days[0].keys);
    // Intra-list diversity is 1 − the engine's weighted simFamily per pair, so each
    // per-pair value stays in [0, 1] (review P2-2: key-name Jaccard overstated it).
    expect(run.mean_intra_list_diversity.story).toBeGreaterThanOrEqual(0);
    expect(run.mean_intra_list_diversity.story).toBeLessThanOrEqual(1);
    expect(run.mean_intra_list_diversity.feeling).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// H — the calibrate core (SPEC §3.4, §3.5)
// ---------------------------------------------------------------------------

describe("calibrate core (test H, §3)", () => {
  it("is deterministic over the committed canon population: identical tables, 85 non-music items, ordered by key", () => {
    const catalog = canonCatalog();
    expect(catalog.length).toBe(85);
    // §3.2 mandates the population ordered by `canon:<slug>` ascending — what the script
    // will build before it calls calibrate(); verify it against the ordered construction.
    const items = [...catalog].sort((a, b) => candidateKey(a).localeCompare(candidateKey(b)));
    const keys = items.map((m) => candidateKey(m));
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));

    const sim = {
      story: (a: MediaItem, b: MediaItem) => simFamily("story", a.profile!.vector.story ?? {}, b.profile!.vector.story ?? {}),
      feeling: (a: MediaItem, b: MediaItem) => simFamily("feeling", a.profile!.vector.feeling ?? {}, b.profile!.vector.feeling ?? {}),
    };
    const first = calibrate({ items, sim });
    const second = calibrate({ items, sim });
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
  });

  it("a population of 59 errors and computes nothing", () => {
    const items = canonCatalog().slice(0, 59);
    const result = calibrate({
      items,
      sim: {
        story: () => 0.5,
        feeling: () => 0.5,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/population 59 < 60/);
  });
});
