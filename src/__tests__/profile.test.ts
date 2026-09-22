import { describe, expect, it } from "vitest";
import { buildUserProfile, pickActivePhase, MATCHED_CATEGORIES, PROFILED_CATEGORIES } from "@/lib/taste/profile";
import type { Anchor } from "@/lib/taste/profile";
import { usableProfile, entryVectorFamily } from "@/lib/taste/affinity";
import { minutesToFinish, band as formBand } from "@/lib/taste/form";
import { familyOf, isKnownKeyIn } from "@/lib/taste/vocabulary";
import { PROFILE_VERSION, FEATURE_VERSION } from "@/lib/taste/weights";
import type { AttributeVector, EntryWithContext, ItemProfile, MediaItem, Phase } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures. Item profiles are hand-authored placeholders (SPEC §C: tests need no
// model); the real canon profiles are a later session's generated file.
// ---------------------------------------------------------------------------

let seq = 0;
const profile = (story: AttributeVector, feeling: AttributeVector, band: 0 | 1 | 2 | 3 | null): ItemProfile => ({
  profile_version: PROFILE_VERSION,
  vocabulary_version: "v2",
  premise: null,
  story: [],
  feeling: [],
  form: { minutes_to_finish: null, band, craft: [] },
  vector: { story, feeling },
});

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: `item-${++seq}`, category: "movie", title: `Item ${seq}`, subtitle: null, source: "test", external_id: `x${seq}`,
  image_url: null, release_year: null, creators: [], genre_tags: [], metadata: {}, feel_prior: null,
  ...over,
});

type Seed = {
  key: string;
  status?: "completed" | "dropped" | "want";
  dims?: Record<string, boolean>;
  note?: string | null;
  score?: number | null;
  reading?: { vector: { story: AttributeVector; feeling: AttributeVector }; absent?: string[]; valued?: string[]; didntWork?: Array<{ key: string; weight: number }> } | null;
  band?: 0 | 1 | 2 | 3 | null;
  profileVec?: { story: AttributeVector; feeling: AttributeVector } | null;
  doesntHit?: boolean;
  creators?: Array<{ name: string; role: string }>;
  category?: MediaItem["category"];
};

const entryFrom = (s: Seed, i: number): EntryWithContext => {
  const it = item({
    id: `item-${s.key}`,
    category: s.category ?? "movie",
    creators: s.creators ?? [],
    profile: s.profileVec ? profile(s.profileVec.story, s.profileVec.feeling, s.band ?? null) : undefined,
  });
  const created = new Date(Date.UTC(2026, 7, 1 + i)).toISOString();
  const e: EntryWithContext = {
    entry: { id: `entry-${s.key}`, user_id: "u", media_item_id: it.id, status: s.status ?? "completed", private_score: s.score ?? null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day", origin: "log", created_at: created, updated_at: created },
    item: it,
    reactions: [],
    extractions: [],
    resurfaces: [],
  };
  if (s.dims || s.note) {
    const rid = `reaction-${s.key}`;
    e.reactions.push({ id: rid, entry_id: e.entry.id, user_id: "u", dimensions: s.dims ?? {}, raw_note: s.note ?? null, source: "log", created_at: created });
  }
  if (s.reading) {
    e.extractions.push({
      id: `x-${s.key}`, reaction_id: e.reactions[0]?.id ?? null, entry_id: e.entry.id, user_id: "u", status: "done",
      attributes: { absent: s.reading.absent ?? [], valued: s.reading.valued ?? [], didnt_work: { keys: s.reading.didntWork ?? [], phrases: [] } } as never,
      vector: s.reading.vector as never,
      vocabulary_version: "v2", extractor: "mock", attempts: 1, last_error: null, extracted_at: created, created_at: created,
    });
  }
  if (s.doesntHit) e.resurfaces.push({ id: `rs-${s.key}`, user_id: "u", entry_id: e.entry.id, surfaced_at: created, channel: "home", response: "doesnt_hit", responded_at: created, note_reaction_id: null, snoozed_until: null });
  return e;
};

const NOW = new Date(Date.UTC(2026, 8, 17));

// ---------------------------------------------------------------------------
describe("loved threshold (SPEC §4.1/§4.3, test matrix #7)", () => {
  // Affinity arithmetic: completed = 0.5; +moved_me = 0.68; +note > 20 chars = 0.76.
  // A note alone = 0.58 (loved). Plain completed with no taps = 0.50 (not loved).
  it("an entry at aff 0.58 is loved; a plain completed entry at 0.50 is not", () => {
    const lib = [
      entryFrom({ key: "a", dims: { moved_me: true }, note: "a note over twenty characters long, honestly written", profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, 0),
      entryFrom({ key: "b", dims: {}, note: null, profileVec: { story: { "theme.memory": 1 }, feeling: {} } }, 1),
    ];
    const p = buildUserProfile(lib, [], undefined, NOW);
    const anchors = (p.story?.anchors ?? []).map((a: Anchor) => a.entryId);
    expect(anchors).toContain("entry-a");
    expect(anchors).not.toContain("entry-b");
    expect(p.evidence.loved).toBe(1);
  });

  it("a want entry is never loved, never an anchor", () => {
    const lib = entryFrom({ key: "w", status: "want", dims: { loved: true }, note: "want" }, 0);
    const p = buildUserProfile([lib], [], undefined, NOW);
    expect(p.story).toBeNull();
    expect(p.feeling).toBeNull();
  });
});

describe("absent handling (§4.2, test matrix #8)", () => {
  it("a reading's absent keys are removed from the entry vector even when the profile carries them", () => {
    const e = entryFrom({
      key: "abs", dims: { loved: true }, note: "no quiet feeling here",
      reading: { vector: { story: {}, feeling: { "register.quiet": 0.9 } }, absent: ["register.quiet"] },
      profileVec: { story: { "theme.grief": 1 }, feeling: { "register.quiet": 1, "tone.warm": 0.5 } },
    }, 0);
    expect(usableProfile(e.item)).not.toBeNull();
    const v = entryVectorFamily(e, "feeling")!;
    expect(v["register.quiet"]).toBeUndefined();
    expect(v["tone.warm"]).toBeDefined();
  });

  it("absent on the story family zeroes story keys; the other family is untouched", () => {
    const e = entryFrom({
      key: "abs2", note: "not about grief",
      reading: { vector: { story: { "theme.grief": 1 }, feeling: {} }, absent: ["theme.grief"] },
      profileVec: { story: { "theme.grief": 1, "theme.memory": 0.5 }, feeling: {} },
    }, 0);
    const story = entryVectorFamily(e, "story")!;
    expect(story["theme.grief"]).toBeUndefined();
    expect(story["theme.memory"]).toBeCloseTo(0.1, 10); // 0.2 profile share after the 0.8/0.2 blend
  });
});

describe("reading/profile blend (§4.2, test matrix #9)", () => {
  it("with a note: 0.8 reading + 0.2 profile; without: the profile alone", () => {
    const withNote = entryFrom({
      key: "n1", note: "something I keep thinking about",
      reading: { vector: { story: { "theme.grief": 1 }, feeling: {} } },
      profileVec: { story: { "theme.grief": 0 }, feeling: {} },
    }, 0);
    const v1 = entryVectorFamily(withNote, "story")!;
    expect(v1["theme.grief"]).toBeCloseTo(0.8 * 1 + 0.2 * 0, 10);

    const noNote = entryFrom({ key: "n2", profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, 1);
    expect(entryVectorFamily(noNote, "story")).toEqual({ "theme.grief": 1 });
  });

  it("no profile and no reading → null; no profile with a reading → the reading alone", () => {
    const bare = entryFrom({ key: "bare" }, 0);
    expect(entryVectorFamily(bare, "story")).toBeNull();
    expect(entryVectorFamily(bare, "feeling")).toBeNull();

    const readOnly = entryFrom({ key: "ro", note: "a note", reading: { vector: { story: { "theme.grief": 1 }, feeling: {} } } }, 1);
    expect(entryVectorFamily(readOnly, "story")).toEqual({ "theme.grief": 1 });
  });
});

describe("missing profiles (§4.3, test matrix #10)", () => {
  it("a library of taps on unprofiled items gives null family profiles", () => {
    const lib = [
      entryFrom({ key: "t1", dims: { loved: true } }, 0),
      entryFrom({ key: "t2", dims: { loved: true } }, 1),
      entryFrom({ key: "t3", dims: { loved: true }, category: "book" }, 2),
    ];
    const p = buildUserProfile(lib, [], undefined, NOW);
    expect(p.story).toBeNull();
    expect(p.feeling).toBeNull();
    expect(p.evidence.profiled).toBe(0);
    expect(p.evidence.loved).toBe(3);
  });
});

describe("anti-profile minimum evidence (§4.6, test matrix #11)", () => {
  it("one dropped entry alone → null; a drop plus a second piece → non-null", () => {
    const drop = entryFrom({ key: "d1", status: "dropped", profileVec: { story: { "theme.war": 1 }, feeling: {} } }, 0);
    const one = buildUserProfile([drop], [], undefined, NOW);
    expect(one.anti.story).toBeNull();

    // A second drop is a second (entry, source) pair.
    const drop2 = entryFrom({ key: "d2", status: "dropped", profileVec: { story: { "theme.war": 0.5 }, feeling: {} } }, 1);
    const two = buildUserProfile([drop, drop2], [], undefined, NOW);
    expect(two.anti.story).not.toBeNull();
    expect(two.anti.evidence).toBe(2);

    // A drop plus a doesnt_hit on another entry: two pieces, both sources.
    const dh = entryFrom({ key: "d3", doesntHit: true, profileVec: { story: { "theme.war": 0.2 }, feeling: {} } }, 2);
    const mixed = buildUserProfile([drop, dh], [], undefined, NOW);
    expect(mixed.anti.story).not.toBeNull();
    expect(mixed.anti.evidence).toBe(2);
  });

  it("didnt_work keys route to their family with a 0.5 floor", () => {
    const e = entryFrom({ key: "dw", note: "slow" }, 0);
    e.extractions.push({
      id: "x-dw", reaction_id: e.reactions[0].id, entry_id: e.entry.id, user_id: "u", status: "done",
      attributes: { absent: [], valued: [], didnt_work: { keys: [{ key: "momentum.suspenseful", weight: 0.8 }], phrases: ["slow"] } } as never,
      vector: { story: {}, feeling: {} } as never,
      vocabulary_version: "v2", extractor: "mock", attempts: 1, last_error: null, extracted_at: e.entry.created_at, created_at: e.entry.created_at,
    });
    const other = entryFrom({ key: "dw2", status: "dropped", profileVec: { story: { "theme.war": 1 }, feeling: {} } }, 1);
    const p = buildUserProfile([e, other], [], undefined, NOW);
    expect(p.anti.story).not.toBeNull();
    expect(p.anti.story!["momentum.suspenseful"]).toBeGreaterThan(0);
  });

  it("one note with two story didnt_work keys is one piece of evidence: anti.story stays null", () => {
    const e = entryFrom({
      key: "dw-multi", note: "both missed",
      reading: { vector: { story: {}, feeling: {} }, didntWork: [{ key: "momentum.suspenseful", weight: 0.8 }, { key: "theme.war", weight: 0.7 }] },
    }, 0);
    const p = buildUserProfile([e], [], undefined, NOW);
    expect(p.anti.story).toBeNull();
    expect(p.anti.evidence).toBe(1);
  });

  it("two different entries with story didnt_work evidence do activate anti.story", () => {
    const a = entryFrom({
      key: "dw-a", note: "missed one",
      reading: { vector: { story: {}, feeling: {} }, didntWork: [{ key: "momentum.suspenseful", weight: 0.8 }] },
    }, 0);
    const b = entryFrom({
      key: "dw-b", note: "missed two",
      reading: { vector: { story: {}, feeling: {} }, didntWork: [{ key: "theme.war", weight: 0.6 }] },
    }, 1);
    const p = buildUserProfile([a, b], [], undefined, NOW);
    expect(p.anti.story).not.toBeNull();
    expect(p.anti.story!["momentum.suspenseful"]).toBeGreaterThan(0);
    expect(p.anti.story!["theme.war"]).toBeGreaterThan(0);
    expect(p.anti.evidence).toBe(2);
  });

  it("one entry can feed both families, but each family still needs two distinct evidence IDs", () => {
    const mixed = entryFrom({
      key: "dw-both", note: "story and feeling both missed",
      reading: { vector: { story: {}, feeling: { "tone.bleak": 0.6 } }, didntWork: [{ key: "theme.war", weight: 0.8 }, { key: "tone.bleak", weight: 0.7 }] },
    }, 0);
    const both = buildUserProfile([mixed], [], undefined, NOW);
    expect(both.anti.story).toBeNull();
    expect(both.anti.feeling).toBeNull();
    expect(both.anti.evidence).toBe(1);

    // The second piece is a dropped entry with a real feeling vector on that family only.
    const drop = entryFrom({ key: "dw-drop", status: "dropped", profileVec: { story: { "theme.war": 1 }, feeling: { "tone.bleak": 1 } } }, 1);
    const p = buildUserProfile([mixed, drop], [], undefined, NOW);
    expect(p.anti.story).not.toBeNull(); // mixed + drop: two story evidence IDs
    expect(p.anti.feeling).not.toBeNull(); // mixed + drop: two feeling evidence IDs
    expect(p.anti.evidence).toBe(2);
  });

  it("malformed didnt_work keys neither enter the anti-profile nor count as evidence", () => {
    const a = entryFrom({
      key: "dw-bad", note: "nonsense keys",
      reading: {
        vector: { story: {}, feeling: {} },
        didntWork: [
          { key: "theme.not-a-real-value", weight: 0.8 },
          { key: "theme.grief.extra", weight: 0.8 },
          { key: "theme.", weight: 0.8 },
        ],
      },
    }, 0);
    const p = buildUserProfile([a], [], undefined, NOW);
    expect(p.anti.story).toBeNull();
    expect(p.anti.feeling).toBeNull();
    expect(p.anti.evidence).toBe(0);
  });
});

describe("active phase selection (§4.7, test matrix #12)", () => {
  const phase = (over: Partial<Phase>): Phase => ({
    id: `ph-${++seq}`, user_id: "u", kind: "feeling_cluster", fingerprint: `fp-${seq}`, label: "A phase", user_label: null,
    start_at: "2026-07-01", end_at: "2026-08-30", category: null, confidence: 0.8, evidence: { dominant: "aftertaste.devastating", second: "tone.warm" },
    dismissed: false, detected_at: "2026-08-30",
    ...over,
  });

  it("two eligible phases → higher confidence wins", () => {
    const a = phase({ id: "ph-a", confidence: 0.6 });
    const b = phase({ id: "ph-b", confidence: 0.9 });
    const p = pickActivePhase([a, b], NOW);
    expect(p!.id).toBe("ph-b");
    expect(p!.key).toBe("aftertaste.devastating");
    expect(p!.second).toBe("tone.warm");
  });

  it("a creator_run is never chosen; a dismissed phase is not either", () => {
    const cr = phase({ kind: "creator_run", confidence: 0.99, evidence: { creator: "Someone" } });
    const dismissed = phase({ confidence: 0.95, dismissed: true });
    const eligible = phase({ confidence: 0.4 });
    expect(pickActivePhase([cr, dismissed, eligible], NOW)!.confidence).toBe(0.4);
  });

  it("a phase ended 91 days ago is not active; one ended 89 days ago is", () => {
    const old = phase({ end_at: new Date(NOW.getTime() - 91 * 86_400_000).toISOString().slice(0, 10) });
    const fresh = phase({ end_at: new Date(NOW.getTime() - 89 * 86_400_000).toISOString().slice(0, 10) });
    expect(pickActivePhase([old], NOW)).toBeNull();
    expect(pickActivePhase([fresh], NOW)).not.toBeNull();
  });

  it("ties break by latest end_at, then fingerprint ascending", () => {
    const a = phase({ id: "ph-a", fingerprint: "fp-a", end_at: "2026-08-30" });
    const b = phase({ id: "ph-b", fingerprint: "fp-b", end_at: "2026-08-31" });
    expect(pickActivePhase([a, b], NOW)!.id).toBe("ph-b");
    const c = phase({ id: "ph-c", fingerprint: "fp-c", end_at: "2026-08-30" });
    expect(pickActivePhase([a, c], NOW)!.id).toBe("ph-a");
  });

  it("a genre_run takes its genre; a category_stretch its category", () => {
    const g = phase({ kind: "genre_run", evidence: { genre: "science fiction" } });
    expect(pickActivePhase([g], NOW)!.key).toBe("science fiction");
    const c = phase({ kind: "category_stretch", evidence: { category: "book" } });
    expect(pickActivePhase([c], NOW)!.key).toBe("book");
  });
});

describe("form distribution (§4.4, test matrix #14)", () => {
  it("a category with 2 loved banded entries is omitted; with 3 it sums to 1", () => {
    const mkBanded = (key: string, b: 0 | 1 | 2 | 3, i: number) =>
      entryFrom({ key, dims: { loved: true }, band: b, profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, i);
    const two = buildUserProfile([mkBanded("f1", 0, 0), mkBanded("f2", 2, 1)], [], undefined, NOW);
    expect(two.form.movie).toBeUndefined();

    const three = buildUserProfile(
      [mkBanded("g1", 0, 0), mkBanded("g2", 2, 1), mkBanded("g3", 2, 2)],
      [], undefined, NOW,
    );
    const d = three.form.movie!.dist;
    expect(three.form.movie!.n).toBe(3);
    expect(d[0] + d[1] + d[2] + d[3]).toBeCloseTo(1, 10);
    // equal affinities → equal shares: 1/3, 0, 2/3, 0
    expect(d[0]).toBeCloseTo(1 / 3, 10);
    expect(d[2]).toBeCloseTo(2 / 3, 10);
  });

  it("loved entries with unknown band do not count toward n", () => {
    const mkUnbanded = (key: string, i: number) =>
      entryFrom({ key, dims: { loved: true }, band: null, profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, i);
    const p = buildUserProfile([mkUnbanded("u1", 0), mkUnbanded("u2", 1), mkUnbanded("u3", 2)], [], undefined, NOW);
    expect(p.form.movie).toBeUndefined();
  });
});

describe("centroid and anchors (§4.3)", () => {
  it("one loved profiled entry: the centroid equals that entry's vector and there is one anchor", () => {
    const e = entryFrom({ key: "solo", dims: { loved: true }, profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, 0);
    const p = buildUserProfile([e], [], undefined, NOW);
    expect(p.story!.centroid).toEqual({ "theme.grief": 1 });
    expect(p.story!.anchors).toHaveLength(1);
    expect(p.story!.anchors[0].ownWords).toBe(false);
  });

  it("anchors order by affinity desc, then newest first; ownWords follows a noted v2 reading", () => {
    // aff: loved+moved = 0.98 (no note); loved+note = 0.88. Affinity leads the order.
    // ownWords requires a done v2 reading whose reaction carries the note (§4.3).
    const strong = entryFrom({ key: "strong", dims: { loved: true }, note: "my own words about it", reading: { vector: { story: { "theme.grief": 1 }, feeling: {} } }, profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, 0);
    const stronger = entryFrom({ key: "stronger", dims: { loved: true, moved_me: true }, profileVec: { story: { "theme.memory": 1 }, feeling: {} } }, 1);
    const p = buildUserProfile([strong, stronger], [], undefined, NOW);
    expect(p.story!.anchors.map((a) => a.entryId)).toEqual(["entry-stronger", "entry-strong"]);
    expect(p.story!.anchors[1].ownWords).toBe(true);
  });

  it("empty library → everything null, no error", () => {
    const p = buildUserProfile([], [], undefined, NOW);
    expect(p.story).toBeNull();
    expect(p.feeling).toBeNull();
    expect(p.activePhase).toBeNull();
    expect(p.anti.story).toBeNull();
    expect(p.anti.evidence).toBe(0);
    expect(p.evidence.loved).toBe(0);
  });

  it("usableProfile treats a wrong-version profile as unprofiled", () => {
    const e = entryFrom({ key: "old" }, 0);
    e.item.profile = { ...profile({}, {}, null), profile_version: "p0" };
    expect(usableProfile(e.item)).toBeNull();
    expect(FEATURE_VERSION).toBe("f1");
  });

  it("an empty family vector is missing evidence, not profile evidence", () => {
    const e = entryFrom({ key: "empty-family", profileVec: { story: { "theme.grief": 1 }, feeling: {} } }, 0);
    expect(entryVectorFamily(e, "story")).toEqual({ "theme.grief": 1 });
    expect(entryVectorFamily(e, "feeling")).toBeNull();
  });

  it("entryVectorFamily preserves a profile story scalar the reading omits", () => {
    const e = entryFrom({
      key: "scalar", note: "a note",
      reading: { vector: { story: { "theme.grief": 1 }, feeling: { "tone.warm": 0.5 } } },
      profileVec: { story: { "theme.grief": 1, complexity: 0.9 }, feeling: {} },
    }, 0);
    const v = entryVectorFamily(e, "story")!;
    expect(v["theme.grief"]).toBeCloseTo(1, 10); // word key: weighted mean with missing = zero
    expect(v.complexity).toBeCloseTo(0.9, 10); // defined-only: (0.9 × 0.2) / 0.2, not 0.9 × 0.2 / 1
  });
});

describe("strict closed vocabulary (v2 keys are exact)", () => {
  it("familyOf resolves exact keys to their family", () => {
    expect(familyOf("theme.grief")).toBe("story");
    expect(familyOf("tone.warm")).toBe("feeling");
    expect(familyOf("complexity")).toBe("story");
    expect(familyOf("pace")).toBe("feeling");
    expect(familyOf("moral-complexity")).toBe("story");
  });

  it("familyOf rejects malformed and unknown keys", () => {
    expect(familyOf("theme.not-real")).toBeNull();
    expect(familyOf("theme.grief.extra")).toBeNull();
    expect(familyOf("theme.")).toBeNull();
    expect(familyOf(".grief")).toBeNull();
    expect(familyOf("grief")).toBeNull(); // bare word: not a scalar
    expect(familyOf("not-a-scalar")).toBeNull();
  });

  it("isKnownKeyIn agrees with familyOf per family", () => {
    expect(isKnownKeyIn("theme.grief", "story")).toBe(true);
    expect(isKnownKeyIn("theme.grief", "feeling")).toBe(false);
    expect(isKnownKeyIn("tone.warm", "feeling")).toBe(true);
    expect(isKnownKeyIn("complexity", "story")).toBe(true);
    expect(isKnownKeyIn("pace", "feeling")).toBe(true);
    expect(isKnownKeyIn("pace", "story")).toBe(false);
    expect(isKnownKeyIn("theme.not-real", "story")).toBe(false);
    expect(isKnownKeyIn("theme.grief.extra", "story")).toBe(false);
    expect(isKnownKeyIn("theme.", "story")).toBe(false);
    expect(isKnownKeyIn("not-a-scalar", "feeling")).toBe(false);
  });

  it("all five media are profiled; only four are matched", () => {
    expect(PROFILED_CATEGORIES).toEqual(["movie", "tv", "anime", "book", "music"]);
    expect(MATCHED_CATEGORIES).toEqual(["movie", "tv", "anime", "book"]);
    expect(PROFILED_CATEGORIES.includes("music")).toBe(true);
    expect(MATCHED_CATEGORIES).not.toContain("music");
  });
});

describe("form helpers agree with the profile layer", () => {
  it("band(minutesToFinish(item)) round-trips a film and a book", () => {
    const film = item({ category: "movie", metadata: { runtime_minutes: 100 } });
    expect(formBand("movie", minutesToFinish(film))).toBe(1);
    const book = item({ category: "book", metadata: { pages: 500 } });
    expect(formBand("book", minutesToFinish(book))).toBe(2); // 500 pages × 1.6 = 800 min
    expect(formBand("book", minutesToFinish(item({ category: "book", metadata: { pages: 200 } })))).toBe(1); // 320 min
  });
});
