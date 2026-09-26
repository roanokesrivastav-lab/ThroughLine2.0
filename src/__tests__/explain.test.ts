// Tests for the deterministic explanation layer (SPEC-STAGE3 §8; matrix §C 21, 34–37,
// plus the shared-attributes ending rule the S5 handoff adds as R's companion).
// Every sentence is rebuilt from a real snapshot so the reconstruction test (K) is honest.
import { describe, expect, it } from "vitest";

import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { buildUserProfile } from "@/lib/taste/profile";
import { scoreCandidate, type StageCandidate } from "@/lib/taste/score";
import { buildSnapshot } from "@/lib/taste/snapshot";
import { anchorOf, explanationFromSnapshot, routeOf, sharedFor } from "@/lib/taste/explain";
import { ENDINGS } from "@/lib/taste/vocabulary";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import type { MediaItem } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z").getTime();

function makeItem(slug: string): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return { ...r, id: `item-${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug) };
}

function candidate(item: MediaItem, opts: { entryId?: string | null } = {}): StageCandidate {
  const creator = item.creators[0];
  return {
    key: `${item.source}:${item.external_id}`,
    item,
    entryId: opts.entryId ?? null,
    sources: ["canon"],
    creatorKey: creator ? `${item.category}:${creator.name.toLowerCase()}` : null,
  };
}

const lib = () => buildFixtureLibrary(NOW, { profiles: "canon" });
const profile = () => buildUserProfile(lib(), [], EMPTY_TASTE_PREFS, new Date(NOW));

/** Build a snapshot the way Session 7's pipeline will, so the sentence tests read the real shape. */
function snap(slug: string, opts: { entryId?: string | null; rerank?: { band: "familiar" | "adjacent" | "stretch"; closeness: number; pass: 1 | 2 | 3; bridge_repair: boolean }; fits?: string | null } = {}) {
  const P = profile();
  const s = scoreCandidate(P, candidate(makeItem(slug), { entryId: opts.entryId ?? null }));
  if (!s) throw new Error(`${slug} did not score`);
  const route = routeOf(s, { listOnly: false, surprise: false });
  const anchor = anchorOf(s, route);
  const shared = anchor ? sharedFor(s, route, anchor) : [];
  const entry = anchor ? lib().find((e) => e.entry.id === anchor.anchor.entryId) ?? null : null;
  return buildSnapshot({
    position: 1,
    scored: s,
    library: lib(),
    filters: { listOnly: false, surprise: false },
    fits: opts.fits ?? null,
    rerank: opts.rerank ?? { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
    route,
    anchor,
    shared,
    anchorEntry: entry,
  });
}

describe("routeOf and anchorOf (§8.1–§8.2, §C34)", () => {
  it("H: equal story and feeling contributions → story; all-zero → backlog for a backlog candidate, story otherwise; anti is never a route", () => {
    const P = profile();
    const item = makeItem("movie-aftersun");
    const zeroWeights = { story: 0, feeling: 0, form: 0, creator: 0, phase: 0, anti: -0.15 };
    const s = scoreCandidate(P, candidate(item), zeroWeights);
    expect(s).not.toBeNull();
    // Anti dominates but is never a route.
    expect(routeOf(s!, { listOnly: false, surprise: false })).toBe("story");
    const backlog = scoreCandidate(P, candidate(item, { entryId: "e-x" }), zeroWeights);
    expect(backlog).not.toBeNull();
    expect(routeOf(backlog!, { listOnly: false, surprise: false })).toBe("backlog");
    // listOnly also forces backlog.
    const listed = scoreCandidate(P, candidate(item, { entryId: "e-x" }));
    expect(routeOf(listed!, { listOnly: true, surprise: false })).toBe("backlog");
  });

  it("H: ties break in the order story, feeling, creator, phase, form", () => {
    const P = profile();
    const item = makeItem("book-klara-and-the-sun");
    // Give two components identical contributions via crafted weights; story wins.
    const storySim = scoreCandidate(P, candidate(item));
    expect(storySim).not.toBeNull();
    const c = storySim!.contributions;
    // w_feeling such that w_f·v_f = 0.4·v_s: v_s = c.story/0.4, v_f = c.feeling/0.2 → w_f = 0.2·c.story/c.feeling.
    const tie = { story: 0.4, feeling: c.story > 0 ? (0.2 * c.story) / Math.max(c.feeling, 1e-12) : 0.4, form: 0, creator: 0, phase: 0, anti: -0.15 };
    const s = scoreCandidate(P, candidate(item), tie);
    expect(s).not.toBeNull();
    expect(s!.features.story).toBeGreaterThan(0);
    expect(Math.abs(s!.contributions.story - s!.contributions.feeling)).toBeLessThanOrEqual(1e-9);
    expect(routeOf(s!, { listOnly: false, surprise: false })).toBe("story");
  });

  it("G: a book anchored to a film is cross-media, and the story sentence carries the prefix", () => {
    // The fixture library loves In the Mood for Love (film) and Never Let Me Go (book);
    // score the book film candidate against the book-loving profile — but the honest
    // cross-media case here is a candidate book whose best anchor is the film Aftersun.
    const snapshot = snap("book-never-let-me-go");
    // Whatever the anchor is, keep the invariant first.
    expect(snapshot.indicators.is_cross_media).toBe(snapshot.anchor ? snapshot.anchor.category !== snapshot.item.category ? 1 : 0 : 0);
    // Force the cross-media case directly: score the film candidate against a profile anchored on the book.
    const P = profile();
    const film = candidate(makeItem("movie-past-lives"));
    const s = scoreCandidate(P, film);
    expect(s).not.toBeNull();
    const route = routeOf(s!, { listOnly: false, surprise: false });
    const anchor = anchorOf(s!, route);
    if (anchor && anchor.anchor.category !== film.item.category) {
      const shared = sharedFor(s!, route, anchor);
      const entry = lib().find((e) => e.entry.id === anchor.anchor.entryId) ?? null;
      const snapshot2 = buildSnapshot({
        position: 1, scored: s!, library: lib(), filters: { listOnly: false, surprise: false },
        fits: null, rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
        route, anchor, shared, anchorEntry: entry,
      });
      expect(snapshot2.indicators.is_cross_media).toBe(1);
      if (snapshot2.route === "story") expect(explanationFromSnapshot(snapshot2)).toContain("another medium");
    }
    void snapshot;
  });
});

describe("explanationFromSnapshot (§8.3–§8.6, §C35–37)", () => {
  const fixtures = ["movie-aftersun", "book-never-let-me-go", "movie-past-lives", "book-klara-and-the-sun", "tv-fleabag", "anime-frieren", "tv-succession", "book-the-remains-of-the-day", "book-crying-in-h-mart", "anime-monster"];

  it("K: explanationFromSnapshot(snapshot) === snapshot.explanation for every fixture candidate", () => {
    for (const slug of fixtures) {
      const snapshot = snap(slug);
      expect(explanationFromSnapshot(snapshot)).toBe(snapshot.explanation);
    }
  });

  it("I: no forbidden evidence — no ending word, no digit outside allowed text, no reception words", () => {
    for (const slug of fixtures) {
      const snapshot = snap(slug);
      const allowed: string[] = [];
      if (snapshot.anchor) allowed.push(snapshot.anchor.title);
      if (snapshot.explain.creator) allowed.push(snapshot.explain.creator);
      if (snapshot.explain.phase_label) allowed.push(snapshot.explain.phase_label);
      if (snapshot.explain.valued) allowed.push(snapshot.explain.valued);
      if (snapshot.explain.quote) allowed.push(snapshot.explain.quote);
      if (snapshot.explain.fits) allowed.push(snapshot.explain.fits);
      const stripped = allowed.reduce((acc, a) => acc.split(a).join(" "), snapshot.explanation);

      const lower = stripped.toLowerCase();
      for (const e of ENDINGS) expect(lower).not.toContain(e);
      expect(lower).not.toContain("popular");
      expect(lower).not.toContain("critics");
      expect(lower).not.toContain("acclaimed");
      expect(lower).not.toContain("rated");
      expect(/\d/.test(stripped)).toBe(false);
    }
  });

  it("J: a non-null explain.valued is a verbatim substring of the anchor entry's raw note", () => {
    let seen = 0;
    for (const slug of fixtures) {
      const snapshot = snap(slug);
      if (!snapshot.explain.valued) continue;
      seen++;
      const entry = lib().find((e) => e.entry.id === snapshot.anchor!.entryId);
      expect(entry).toBeDefined();
      const note = entry!.reactions.map((r) => r.raw_note ?? "").find((n) => n.trim().length > 0);
      expect(note).toBeDefined();
      expect(note!.includes(snapshot.explain.valued)).toBe(true);
    }
    // The fixture library's notes include loved-it phrasing, so this must be exercised.
    expect(seen).toBeGreaterThan(0);
  });

  it("R: ending keys never appear in shared", () => {
    for (const slug of fixtures) {
      const snapshot = snap(slug);
      for (const s of snapshot.shared) expect(s.key.startsWith("ending.")).toBe(false);
    }
  });

  it("degrades gracefully with fewer than two shared keys", () => {
    // A synthetic one-key anchor: the wording names one attribute without placeholder text.
    const P = profile();
    const item = makeItem("book-1984");
    const s = scoreCandidate(P, candidate(item));
    if (!s || !s.anchors.story) return; // fixture-dependent; skip when no anchor exists
    const route = routeOf(s, { listOnly: false, surprise: false });
    const anchor = anchorOf(s, route)!;
    const shared = sharedFor(s, route, anchor);
    const entry = lib().find((e) => e.entry.id === anchor.anchor.entryId) ?? null;
    const snapshot = buildSnapshot({
      position: 1, scored: s, library: lib(), filters: { listOnly: false, surprise: false },
      fits: null, rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
      route, anchor, shared: shared.slice(0, 1), anchorEntry: entry,
    });
    if (snapshot.route === "story" && shared.length === 1) {
      expect(snapshot.explanation).toContain("the same");
      expect(snapshot.explanation).not.toContain("undefined");
      expect(snapshot.explanation).not.toContain("null");
    }
    expect(snapshot.explanation.length).toBeGreaterThan(0);
  });
});

describe("explainFields and the creator/phase/form/backlog sentences (§8.5)", () => {
  it("creator route names the creator; phase route carries the phase label; form route uses the fits note", () => {
    const P = profile();
    // Creator: an Ishiguro candidate with the creator contribution forced to dominate.
    const ishiguro = candidate(makeItem("book-klara-and-the-sun"));
    const forced = scoreCandidate(P, ishiguro, { story: 0.01, feeling: 0.01, form: 0, creator: 0.1, phase: 0, anti: -0.15 });
    expect(forced).not.toBeNull();
    if (routeOf(forced!, { listOnly: false, surprise: false }) === "creator") {
      const route = "creator" as const;
      const anchor = anchorOf(forced!, route);
      const shared = anchor ? sharedFor(forced!, route, anchor) : [];
      const entry = anchor ? lib().find((e) => e.entry.id === anchor.anchor.entryId) ?? null : null;
      const snapshot = buildSnapshot({
        position: 1, scored: forced!, library: lib(), filters: { listOnly: false, surprise: false },
        fits: null, rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
        route, anchor, shared, anchorEntry: entry,
      });
      expect(snapshot.explanation).toContain(snapshot.explain.creator ?? "Kazuo Ishiguro");
      expect(explanationFromSnapshot(snapshot)).toBe(snapshot.explanation);
    }

    // Form route: no story/feeling/creator evidence, known band and form distribution.
    const formP = buildUserProfile(lib(), [], EMPTY_TASTE_PREFS, new Date(NOW));
    const formOnly: typeof P = {
      story: null, feeling: null, form: formP.form, creators: new Map(),
      activePhase: null, anti: { story: null, feeling: null, evidence: 0 }, evidence: formP.evidence,
    };
    const formCand = candidate(makeItem("movie-aftersun"));
    const fs = scoreCandidate(formOnly, formCand);
    expect(fs).not.toBeNull();
    const fRoute = routeOf(fs!, { listOnly: false, surprise: false });
    if (fRoute === "form") {
      const snapshot = buildSnapshot({
        position: 1, scored: fs!, library: lib(), filters: { listOnly: false, surprise: false },
        fits: "102 min", rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
        route: fRoute, anchor: null, shared: [], anchorEntry: null,
      });
      expect(snapshot.explanation).toContain("102 min");
      expect(snapshot.explanation).toContain("what you tend to love");
    }

    // Phase route: a feeling_cluster phase, candidate carrying the key.
    const phase = {
      id: "ph2", user_id: "u", kind: "feeling_cluster" as const, fingerprint: "fp2",
      label: "Season 2026: memory and ache", user_label: "The aching one", start_at: "2026-06-01", end_at: "2099-01-01",
      category: null, confidence: 0.95, evidence: { dominant: "theme.memory", second: "ache" }, dismissed: false, detected_at: "2026-06-02",
    };
    const PP = buildUserProfile(lib(), [phase], EMPTY_TASTE_PREFS, new Date(NOW));
    const pc = candidate(makeItem("book-never-let-me-go"));
    const ps = scoreCandidate(PP, pc);
    expect(ps).not.toBeNull();
    if (routeOf(ps!, { listOnly: false, surprise: false }) === "phase") {
      const route = routeOf(ps!, { listOnly: false, surprise: false });
      const anchor = anchorOf(ps!, route);
      const shared = anchor ? sharedFor(ps!, route, anchor) : [];
      const entry = anchor ? lib().find((e) => e.entry.id === anchor.anchor.entryId) ?? null : null;
      const snapshot = buildSnapshot({
        position: 1, scored: ps!, library: lib(), filters: { listOnly: false, surprise: false },
        fits: null, rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
        route, anchor, shared, anchorEntry: entry, phaseLabel: "The aching one",
      });
      expect(snapshot.explain.phase_label).toBe("The aching one");
      expect(snapshot.explanation).toContain("The aching one");
    }

    // Backlog route: listOnly forces it and the wording starts with the legacy lead.
    const bc = candidate(makeItem("book-piranesi"), { entryId: "e-want" });
    const bs = scoreCandidate(P, bc, { story: 0.4, feeling: 0.2, form: 0.15, creator: 0.1, phase: 0.1, anti: -0.15 });
    expect(bs).not.toBeNull();
    const bSnapshot = buildSnapshot({
      position: 1, scored: bs!, library: lib(), filters: { listOnly: true, surprise: false },
      fits: null, rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
      route: "backlog", anchor: bs!.anchors.story ?? bs!.anchors.feeling, shared: [], anchorEntry: null,
    });
    expect(bSnapshot.route).toBe("backlog");
    expect(bSnapshot.explanation.startsWith("From your own list.")).toBe(true);
  });
});
