// Tests for the re-ranker (SPEC-STAGE3 §7; matrix §C 27–33, 48). Offline and
// deterministic: scored candidates are hand-built so bands, themes, creators and
// bridges are under exact control; nothing here recomputes a similarity.
import { describe, expect, it } from "vitest";

import { rerank, closeness, bandOf, isBridge, quotasFor } from "@/lib/taste/rerank";
import type { PipelineFilters } from "@/lib/taste/filters";
import type { ScoredCandidate } from "@/lib/taste/score";
import { W0 } from "@/lib/taste/weights";
import type { Category, ItemProfile } from "@/lib/types";

const filters = (over: Partial<PipelineFilters> = {}): PipelineFilters => ({
  category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5,
  ...over,
});

/**
 * A scored candidate with the calibrated closeness both anchors report. `anchorCategory`
 * decides bridging: null means no anchors at all, a different category from the item's
 * makes the candidate a bridge. All contributions are 0, so routeOf resolves to "story"
 * and the story anchor is the route anchor.
 */
function mk(
  key: string,
  close: number,
  opts: {
    score?: number;
    category?: Category;
    creatorKey?: string | null;
    themes?: Record<string, number>;
    anchorCategory?: Category | null;
  } = {},
): ScoredCandidate {
  const category = opts.category ?? "book";
  const profile: ItemProfile = {
    profile_version: "p1",
    vocabulary_version: "v2",
    premise: null,
    story: [],
    feeling: [],
    form: { minutes_to_finish: null, band: null, craft: [] },
    vector: { story: opts.themes ?? {}, feeling: {} },
  };
  const item = {
    id: `item-${key}`, category, title: key, subtitle: null, source: "canon", external_id: key,
    image_url: null, release_year: null, creators: [], genre_tags: [], metadata: {}, feel_prior: null, profile,
  };
  const anchor =
    opts.anchorCategory === null
      ? null
      : {
          anchor: { entryId: `e-${key}`, itemId: `item-${key}`, category: opts.anchorCategory ?? category, vector: {}, affinity: 0.9, ownWords: false },
          sim: close,
          family: "story" as const,
        };
  return {
    candidate: { key, item, entryId: null, sources: ["canon"], creatorKey: opts.creatorKey ?? null },
    features: { story: 0, feeling: 0, form: 0, creator: 0, phase: 0, anti: 0 },
    raw: { story: null, feeling: null, anti: { story: null, feeling: null } },
    has_evidence: { story: false, feeling: false, form: false, creator: false, phase: false, anti: false },
    weights: { ...W0 },
    contributions: { story: 0, feeling: 0, form: 0, creator: 0, phase: 0, anti: 0 },
    score: opts.score ?? close,
    anchors: { story: anchor, feeling: anchor },
  };
}

describe("quotas, closeness and bands (§7.1–§7.2, §C27)", () => {
  it("E: L=5 → 3/1/1, L=3 → 2/0/1, L=1 → 1/0/0, and quotasFor(6..10) follow the formula", () => {
    expect(quotasFor(5)).toEqual({ familiar: 3, adjacent: 1, stretch: 1 });
    expect(quotasFor(3)).toEqual({ familiar: 2, adjacent: 0, stretch: 1 });
    expect(quotasFor(1)).toEqual({ familiar: 1, adjacent: 0, stretch: 0 });
    expect(quotasFor(6)).toEqual({ familiar: 4, adjacent: 1, stretch: 1 });
    expect(quotasFor(7)).toEqual({ familiar: 5, adjacent: 1, stretch: 1 });
    expect(quotasFor(8)).toEqual({ familiar: 5, adjacent: 2, stretch: 1 });
    expect(quotasFor(9)).toEqual({ familiar: 6, adjacent: 2, stretch: 1 });
    expect(quotasFor(10)).toEqual({ familiar: 7, adjacent: 2, stretch: 1 });
  });

  it("E: closeness averages the two calibrated anchor sims; bandOf applies the thresholds", () => {
    const s = mk("canon:x", 0.72);
    expect(closeness(s)).toBeCloseTo(0.72, 12);
    expect(bandOf(0.6)).toBe("familiar");
    expect(bandOf(0.59)).toBe("adjacent");
    expect(bandOf(0.35)).toBe("adjacent");
    expect(bandOf(0.34)).toBe("stretch");
  });

  it("E: enough candidates in every band → 3 familiar, 1 adjacent, 1 stretch at L=5; 2/0/1 at L=3", () => {
    const ordered = [
      mk("canon:f1", 0.9, { score: 0.9 }),
      mk("canon:f2", 0.8, { score: 0.8, category: "movie" }),
      mk("canon:f3", 0.7, { score: 0.7, category: "tv" }),
      mk("canon:a1", 0.5, { score: 0.5 }),
      mk("canon:s1", 0.2, { score: 0.2, category: "movie" }),
    ];
    const { out, policy } = rerank(ordered, filters({ limit: 5 }));
    expect(out.map((x) => x.rerank.band)).toEqual(["familiar", "familiar", "familiar", "adjacent", "stretch"]);
    expect(out.every((x) => x.rerank.pass === 1)).toBe(true);
    expect(policy.quotas).toEqual({ familiar: 3, adjacent: 1, stretch: 1 });
    expect(policy.quota_unfilled).toEqual([]);
    expect(policy.caps_relaxed).toEqual([]);

    const short = rerank(ordered, filters({ limit: 3 })).out;
    expect(short.map((x) => x.rerank.band)).toEqual(["familiar", "familiar", "stretch"]);
  });
});

describe("passes and caps (§7.3, §C28–31)", () => {
  it("F: no stretch candidate → quota_unfilled = ['stretch'] and pass 2 fills the last seat anyway", () => {
    // Three familiar and two adjacent: pass 1 fills 3/1 and stops on the empty quotas,
    // so the second adjacent can only arrive through pass 2.
    const ordered = [
      mk("canon:f1", 0.9, { score: 0.9 }),
      mk("canon:f2", 0.85, { score: 0.85, category: "movie" }),
      mk("canon:f3", 0.8, { score: 0.8, category: "tv" }),
      mk("canon:a1", 0.5, { score: 0.5 }),
      mk("canon:a2", 0.45, { score: 0.45 }),
    ];
    const { out, policy } = rerank(ordered, filters({ limit: 5 }));
    expect(policy.quota_unfilled).toEqual(["stretch"]);
    expect(out).toHaveLength(5);
    expect(out.map((x) => x.rerank.band)).toEqual(["familiar", "familiar", "familiar", "adjacent", "adjacent"]);
    expect(out.find((x) => x.scored.candidate.key === "canon:a1")!.rerank.pass).toBe(1);
    expect(out.find((x) => x.scored.candidate.key === "canon:a2")!.rerank.pass).toBe(2);
  });

  it("G: six candidates by one creator → at most 2 in out, even when that leaves the list short", () => {
    const ordered = [1, 2, 3, 4, 5, 6].map((i) =>
      mk(`canon:g${i}`, 0.9, { score: 1 - i * 0.01, creatorKey: "book:one author" }),
    );
    const { out, policy } = rerank(ordered, filters({ limit: 5 }));
    expect(out).toHaveLength(2);
    const perCreator = new Map<string, number>();
    for (const x of out) {
      const k = x.scored.candidate.creatorKey as string;
      perCreator.set(k, (perCreator.get(k) ?? 0) + 1);
    }
    expect([...perCreator.values()].every((n) => n <= 2)).toBe(true);
    expect(out.every((x) => x.rerank.pass === 1)).toBe(true);
    expect(policy.quota_unfilled).toEqual(["familiar", "adjacent", "stretch"]);
    expect(policy.caps_relaxed).toEqual([]); // the creator cap is never relaxed
  });

  it("H: one category only, no category filter → the category cap relaxes in pass 3 and caps_relaxed lists exactly what admitted someone", () => {
    const ordered = [1, 2, 3, 4, 5].map((i) =>
      mk(`canon:c${i}`, 0.9, { score: 1 - i * 0.01, category: "book" }),
    );
    const { out, policy } = rerank(ordered, filters({ limit: 5 }));
    expect(out).toHaveLength(5);
    expect(out.every((x) => x.scored.candidate.item.category === "book")).toBe(true);
    expect(policy.caps_relaxed).toEqual(["category"]); // the theme relax admitted nobody
    expect(out.filter((x) => x.rerank.pass === 3)).toHaveLength(2);
  });

  it("I: four top candidates sharing theme.grief ≥ 0.5 → at most 3 in a list of 5", () => {
    const grief = [1, 2, 3, 4].map((i) =>
      mk(`canon:gr${i}`, 0.9, { score: 0.9 - i * 0.01, themes: { "theme.grief": 0.9 } }),
    );
    const others = [
      mk("canon:o1", 0.5, { score: 0.5, category: "movie" }),
      mk("canon:o2", 0.5, { score: 0.49, category: "tv" }),
    ];
    const { out, policy } = rerank([...grief, ...others], filters({ limit: 5 }));
    expect(out).toHaveLength(5);
    const griefKeys = out.filter((x) => (x.scored.candidate.item.profile!.vector.story["theme.grief"] ?? 0) >= 0.5);
    expect(griefKeys.length).toBeLessThanOrEqual(3); // ceil(5/2)
    expect(griefKeys.map((x) => x.scored.candidate.key)).toEqual(["canon:gr1", "canon:gr2", "canon:gr3"]);
    expect(policy.caps_relaxed).toEqual([]); // the list filled before any relaxation had a seat
  });
});

describe("bridge repair (§7.4, §C32)", () => {
  it("J: no bridge in out but one lower down → it replaces the last same-band result", () => {
    const ordered = [
      mk("canon:k1", 0.9, { score: 0.9 }),
      mk("canon:k2", 0.85, { score: 0.85, category: "movie" }),
      mk("canon:k3", 0.8, { score: 0.8, category: "tv" }),
      mk("canon:k4", 0.75, { score: 0.75 }),
      mk("canon:k5", 0.7, { score: 0.7, category: "movie" }),
      mk("canon:bridge", 0.6, { score: 0.6, category: "movie", anchorCategory: "book" }), // cross-media
    ];
    const { out } = rerank(ordered, filters({ limit: 5 }));
    expect(out).toHaveLength(5);
    const bridgeRow = out.find((x) => x.scored.candidate.key === "canon:bridge");
    expect(bridgeRow).toBeDefined();
    expect(bridgeRow!.rerank.bridge_repair).toBe(true);
    expect(bridgeRow!.rerank.pass).toBe(3);
    expect(out.some((x) => x.scored.candidate.key === "canon:k5")).toBe(false); // the victim
    // Re-sorted by score descending, so the 0.6 bridge lands last.
    expect(out[out.length - 1]!.scored.candidate.key).toBe("canon:bridge");
    expect(out.map((x) => x.scored.score)).toEqual([0.9, 0.85, 0.8, 0.75, 0.6]);
  });

  it("J: no bridge candidate anywhere → no repair and no error", () => {
    const ordered = [
      mk("canon:k1", 0.9, { score: 0.9 }),
      mk("canon:k2", 0.85, { score: 0.85, category: "movie" }),
      mk("canon:k3", 0.8, { score: 0.8, category: "tv" }),
      mk("canon:k4", 0.75, { score: 0.75 }),
      mk("canon:k5", 0.7, { score: 0.7, category: "movie" }),
    ];
    const { out } = rerank(ordered, filters({ limit: 5 }));
    expect(out.map((x) => x.scored.candidate.key)).toEqual(["canon:k1", "canon:k2", "canon:k3", "canon:k4", "canon:k5"]);
    expect(out.every((x) => x.rerank.bridge_repair === false)).toBe(true);
  });

  it("isBridge: true only when the route anchor exists and sits in another category", () => {
    const f = filters();
    expect(isBridge(mk("canon:a", 0.9, { category: "movie", anchorCategory: "book" }), f)).toBe(true);
    expect(isBridge(mk("canon:b", 0.9, { category: "movie" }), f)).toBe(false);
    expect(isBridge(mk("canon:c", 0.9, { category: "movie", anchorCategory: null }), f)).toBe(false);
  });
});

describe("L = 1 (§C48)", () => {
  it("L: one result, familiar when available, and bridge repair still applies", () => {
    const plain = [mk("canon:k1", 0.9), mk("canon:a1", 0.5, { category: "movie" })];
    const { out } = rerank(plain, filters({ limit: 1 }));
    expect(out.map((x) => x.scored.candidate.key)).toEqual(["canon:k1"]);
    expect(out[0]!.rerank.band).toBe("familiar");

    const withBridge = [
      mk("canon:k1", 0.9),
      mk("canon:bridge", 0.6, { score: 0.6, category: "movie", anchorCategory: "book" }),
    ];
    const repaired = rerank(withBridge, filters({ limit: 1 }));
    expect(repaired.out).toHaveLength(1);
    expect(repaired.out[0]!.scored.candidate.key).toBe("canon:bridge");
    expect(repaired.out[0]!.rerank.bridge_repair).toBe(true);
    expect(repaired.out[0]!.rerank.pass).toBe(3);
  });
});
