import { describe, expect, it, vi } from "vitest";
// Both AI modules are server-only; the alias is mocked away in tests.
vi.mock("server-only", () => ({}));

import { mockExplainer, claudeExplainer, explainerPayload, explanationsByIndex } from "@/lib/ai/explainer";
import { nvidiaExplainer } from "@/lib/ai/nvidia";
import { checkAiExplanation } from "@/lib/taste/explain";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { buildUserProfile } from "@/lib/taste/profile";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import { generateCandidates } from "@/lib/taste/candidates";
import { rankPipeline } from "@/lib/taste/pipeline";
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import type { ImpressionSnapshot } from "@/lib/taste/snapshot";
import type { MediaItem } from "@/lib/types";
import type { PipelineFilters } from "@/lib/taste/filters";
import type { Anthropic } from "@anthropic-ai/sdk";

const NOW = new Date("2026-09-25T12:00:00Z");
const LIB = buildFixtureLibrary(NOW.getTime(), { profiles: "canon" });
const P = buildUserProfile(LIB, [], EMPTY_TASTE_PREFS, NOW);
const FILTERS: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 3 };

/** The deterministic fixture snapshots (no explainer), computed once. */
let SNAPS: ImpressionSnapshot[] | null = null;
function SNAPSHOTS(): ImpressionSnapshot[] {
  if (!SNAPS) {
    const { candidates, sourceCounts, merged } = generateCandidates({
      library: LIB, P, filters: FILTERS, canon: CANON.map((c) => {
        const r = canonToResult(c);
        return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) } as MediaItem;
      }), creatorResults: new Map(), pool: [],
    });
    SNAPS = rankPipeline({ P, library: LIB, prefs: EMPTY_TASTE_PREFS, candidates, filters: FILTERS, recent: [], userId: "u1", now: NOW, sourceCounts, merged }).snapshots;
  }
  return SNAPS;
}

describe("explainerPayload (§2.4)", () => {
  it("G: exactly the §2.4 keys, and the serialized payload leaks nothing it must not", () => {
    expect(SNAPSHOTS().length).toBeGreaterThan(0);
    for (const s of SNAPSHOTS()) {
      const payload = explainerPayload(s);
      expect(Object.keys(payload).sort()).toEqual([
        "anchor", "band", "category", "creator", "creator_they_return_to", "draft", "fits",
        "index", "phase_label", "quote", "route", "shared", "summary", "title", "valued",
      ]);
      const text = JSON.stringify(payload);
      expect(text).not.toContain("raw_note");
      expect(text).not.toContain("features");
      expect(text).not.toContain("weights");
      expect(text).not.toContain("contributions");
      // index is position - 1, so it alone may carry a digit.
      expect(payload.index).toBe(s.position - 1);
    }
  });
});

describe("explanationsByIndex (review P1)", () => {
  it("maps by the named index, out of order", () => {
    expect(explanationsByIndex([{ index: 2, text: "c" }, { index: 0, text: "a" }, { index: 1, text: "b" }], 3)).toEqual(["a", "b", "c"]);
  });
  it("rejects a wrong length, a duplicate and an out-of-range index", () => {
    expect(explanationsByIndex([{ index: 0, text: "a" }], 2)).toBeNull();
    expect(explanationsByIndex([{ index: 0, text: "a" }, { index: 0, text: "a" }], 2)).toBeNull();
    expect(explanationsByIndex([{ index: 2, text: "c" }], 2)).toBeNull();
  });
});

describe("checkAiExplanation (§2.4)", () => {
  it("H: accepts every fixture sentence and rejects the forbidden shapes", () => {
    const snaps = SNAPSHOTS();
    for (const s of snaps) expect(checkAiExplanation(s.explanation, s)).toBe(true);
    const s = snaps[0];
    expect(checkAiExplanation("Critics loved it.", s)).toBe(false);
    expect(checkAiExplanation("Rated 9 of 10.", s)).toBe(false);
    expect(checkAiExplanation("It ends bittersweet.", s)).toBe(false);
    expect(checkAiExplanation("He said “totally invented words” about it.", s)).toBe(false);
    expect(checkAiExplanation("x".repeat(321), s)).toBe(false);
    expect(checkAiExplanation("", s)).toBe(false);
  });

  it("K (§2.5): the recommended item's own digit title is allowed; an invented extra number is not", () => {
    const snaps = SNAPSHOTS();
    const s = { ...snaps[0], item: { ...snaps[0].item, title: "Blade Runner 2049" } };
    // A correct sentence naming the digit-titled item passes (the 7B review carry-over).
    expect(checkAiExplanation("Blade Runner 2049 asks the same quiet question your anchor does.", s)).toBe(true);
    // The same sentence with an invented extra number ("ranked" is not a banned word,
    // so this fails on the digit guard alone) is still rejected.
    expect(checkAiExplanation("Blade Runner 2049 asks the same quiet question your anchor does, ranked 7th.", s)).toBe(false);
  });

  it("K2 (§8.6, DECISIONS #116): the user's own verbatim-quoted words are exempt from the word guards; model-authored ones are not", () => {
    const snaps = SNAPSHOTS();
    const s = snaps.find((x) => (x.explain.quote ?? "").toLowerCase().includes("bittersweet")) ?? snaps[0];
    // Quoting the user's own note verbatim passes even though the note contains an
    // ending word — the guards constrain what the MODEL authors, not what the user wrote.
    expect(checkAiExplanation(`You wrote “${s.explain.quote}” — the same register your anchor lives in.`, s)).toBe(true);
    // The model authoring the same word outside a quote still fails.
    expect(checkAiExplanation("It leaves you bittersweet in the best way.", s)).toBe(false);
    // Quoting the note AND adding an invented ending word outside the quotes still fails.
    expect(checkAiExplanation(`You wrote “${s.explain.quote}” — an open, ambiguous piece overall.`, s)).toBe(false);
  });

  it("exempts only quoted occurrences, even when forbidden words repeat outside them", () => {
    const s = { ...SNAPSHOTS()[0], explain: { ...SNAPSHOTS()[0].explain, quote: "Bittersweet critics gave it 9", valued: null } };
    expect(checkAiExplanation('You wrote “Bittersweet”. Bittersweet is how it ends.', s)).toBe(false);
    expect(checkAiExplanation('You wrote "critics". The critics loved it.', s)).toBe(false);
    expect(checkAiExplanation('You wrote “9”. It earned 9.', s)).toBe(false);
    expect(checkAiExplanation('Bittersweet critics gave it 9', s)).toBe(false);
    expect(checkAiExplanation('You wrote “Bittersweet critics gave it 9”. A familiar feeling.', s)).toBe(true);
  });
});

describe("mock (§2.4)", () => {
  it("K: returns all nulls — keep the deterministic sentence", async () => {
    const snaps = SNAPSHOTS();
    expect(await mockExplainer.explain(snaps)).toEqual(snaps.map(() => null));
  });
});

describe("claude (I)", () => {
  /**
   * A stub whose entries can be shuffled, repeated or dropped: each text is paired with
   * the index it claims, so a position-reading implementation fails these tests.
   */
  function stubClient(entries: Array<{ index: number; text: string }>) {
    const parse = vi.fn(async () => ({
      stop_reason: "end_turn",
      parsed_output: { explanations: entries },
    }));
    return { messages: { parse } } as unknown as Anthropic;
  }

  it("I1: success maps by index and the guard keeps clean sentences", async () => {
    const snaps = SNAPSHOTS();
    const ai = "A warm, specific sentence about the feeling.";
    const out = await claudeExplainer(stubClient(snaps.map((_, i) => ({ index: i, text: ai }))), "m").explain(snaps);
    expect(out).toEqual(snaps.map(() => ai));
  });

  it("I5 (P1): entries returned out of order still land on the right snapshot", async () => {
    const snaps = SNAPSHOTS();
    expect(snaps.length).toBeGreaterThanOrEqual(3);
    const texts = ["First distinct sentence.", "Second distinct sentence.", "Third distinct sentence."];
    const out = await claudeExplainer(
      stubClient(snaps.map((s, i) => ({ index: s.position - 1, text: texts[i] })).reverse()),
      "m",
    ).explain(snaps);
    expect(out).toEqual(texts);
  });

  it("I6 (P1): a missing index → all null, not a shift", async () => {
    const snaps = SNAPSHOTS();
    const entries = snaps.map((s, i) => ({ index: s.position - 1, text: `Sentence for slot ${i}.` }));
    entries.splice(1, 1); // one item's explanation never arrived
    expect(await claudeExplainer(stubClient(entries), "m").explain(snaps)).toEqual(snaps.map(() => null));
  });

  it("I7 (P1): a duplicated index → all null, never a shifted pair", async () => {
    const snaps = SNAPSHOTS();
    expect(snaps.length).toBeGreaterThanOrEqual(3);
    const entries = snaps.map((s, i) => ({ index: s.position - 1, text: `Sentence for slot ${i}.` }));
    entries[2] = { index: entries[1]?.index ?? 0, text: "Sentence for slot 1 again." }; // slot 2's is lost, slot 1's appears twice
    expect(await claudeExplainer(stubClient(entries), "m").explain(snaps)).toEqual(snaps.map(() => null));
  });

  it("I8 (P1): an out-of-range index → all null", async () => {
    const snaps = SNAPSHOTS();
    const entries = snaps.map((s, i) => ({ index: s.position - 1, text: `Sentence for slot ${i}.` }));
    entries[0] = { index: snaps.length, text: "Off the end." };
    expect(await claudeExplainer(stubClient(entries), "m").explain(snaps)).toEqual(snaps.map(() => null));
  });

  it("I2: refusal → all null", async () => {
    const snaps = SNAPSHOTS();
    const parse = vi.fn(async () => ({ stop_reason: "refusal", parsed_output: null }));
    const ex = claudeExplainer({ messages: { parse } } as unknown as Anthropic, "m");
    expect(await ex.explain(snaps)).toEqual(snaps.map(() => null));
  });

  it("I3: throw → all null, never a throw", async () => {
    const snaps = SNAPSHOTS();
    const parse = vi.fn(async () => { throw new Error("api down"); });
    const ex = claudeExplainer({ messages: { parse } } as unknown as Anthropic, "m");
    expect(await ex.explain(snaps)).toEqual(snaps.map(() => null));
  });

  it("I4: one guard-failing item → null for that item only", async () => {
    const snaps = SNAPSHOTS();
    expect(snaps.length).toBeGreaterThanOrEqual(3);
    const out = await claudeExplainer(
      stubClient(["Good sentence about tone.", "Critics loved it.", "Another good one."].map((t, i) => ({ index: i, text: t }))),
      "m",
    ).explain(snaps);
    expect(out[1]).toBeNull();
    expect(out[0]).not.toBeNull();
    expect(out[2]).not.toBeNull();
  });
});

describe("nvidia (J)", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("J1: success maps by index through the shared guard", async () => {
    const snaps = SNAPSHOTS();
    const ai = "Warm, specific sentence.";
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ choices: [{ message: { content: JSON.stringify({ explanations: snaps.map((_, i) => ({ index: i, text: ai })) }) } }] })));
    try {
      expect(await nvidiaExplainer().explain(snaps)).toEqual(snaps.map(() => ai));
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("J2: malformed JSON → all null, never a throw", async () => {
    const snaps = SNAPSHOTS();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ choices: [{ message: { content: "not json at all" } }] })));
    try {
      expect(await nvidiaExplainer().explain(snaps)).toEqual(snaps.map(() => null));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("J3: network error → all null, never a throw (the legacy explainer could throw here)", async () => {
    const snaps = SNAPSHOTS();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    try {
      expect(await nvidiaExplainer().explain(snaps)).toEqual(snaps.map(() => null));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("J4 (P1): entries returned out of order still land on the right snapshot", async () => {
    const snaps = SNAPSHOTS();
    expect(snaps.length).toBeGreaterThanOrEqual(3);
    const texts = ["First distinct sentence.", "Second distinct sentence.", "Third distinct sentence."];
    const entries = snaps.map((s, i) => ({ index: s.position - 1, text: texts[i] })).reverse();
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ choices: [{ message: { content: JSON.stringify({ explanations: entries }) } }] })));
    try {
      expect(await nvidiaExplainer().explain(snaps)).toEqual(texts);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("J5 (P1): a missing index → all null", async () => {
    const snaps = SNAPSHOTS();
    const entries = snaps.map((s, i) => ({ index: s.position - 1, text: `Sentence for slot ${i}.` }));
    entries.splice(1, 1);
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ choices: [{ message: { content: JSON.stringify({ explanations: entries }) } }] })));
    try {
      expect(await nvidiaExplainer().explain(snaps)).toEqual(snaps.map(() => null));
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("J6 (P1): a duplicated index → all null", async () => {
    const snaps = SNAPSHOTS();
    const entries = snaps.map((s, i) => ({ index: s.position - 1, text: `Sentence for slot ${i}.` }));
    entries[2] = { index: entries[1]?.index ?? 0, text: "Sentence for slot 1 again." };
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ choices: [{ message: { content: JSON.stringify({ explanations: entries }) } }] })));
    try {
      expect(await nvidiaExplainer().explain(snaps)).toEqual(snaps.map(() => null));
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
