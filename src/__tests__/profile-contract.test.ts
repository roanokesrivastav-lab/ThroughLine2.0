import { describe, expect, it } from "vitest";
import {
  PROFILE_SYSTEM_PROMPT,
  ProfileDraftSchema,
  ProfileValidationError,
  buildItemProfile,
  profilerInput,
  type ProfileDraft,
} from "@/lib/ai/profile-contract";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { CRAFT, isCraftKey, familyOf } from "@/lib/taste/vocabulary";
import type { MediaItem } from "@/lib/types";

const baseItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: "tmdb:27205",
  category: "movie",
  title: "Inception",
  subtitle: null,
  source: "tmdb",
  external_id: "27205",
  image_url: null,
  release_year: 2010,
  creators: [{ name: "Christopher Nolan", role: "Director" }],
  genre_tags: ["action", "sci-fi"],
  metadata: { runtime_minutes: 148, overview: "A thief who steals corporate secrets through dream-sharing technology." },
  feel_prior: null,
  ...overrides,
});

const emptyDraft = (): ProfileDraft => ({
  premise: null,
  story: {
    theme: [], arc: [], conflict: [], cast: [], bond: [], world: [], setting: [], frame: [],
    structure: [], momentum: [], stakes: [], ending: [],
  },
  feeling: { tone: [], register: [], texture: [], aftertaste: [] },
  scalars: {},
  craft: [],
});

const tag = (key: string, weight = 0.8, confidence = 0.9) => ({ key, weight, confidence });

describe("profile contract (SPEC-STAGE3 §1.2)", () => {
  it("A: a valid strict draft produces a profile stamped with the current versions and correct families", () => {
    const draft = emptyDraft();
    draft.story.theme = [tag("grief")];
    draft.story.stakes = [tag("personal")];
    draft.story.ending = [tag("bittersweet")];
    draft.scalars["moral-complexity"] = { value: 0.5, confidence: 1 };
    draft.scalars.complexity = { value: 0.5, confidence: 1 };
    draft.scalars.intensity = { value: 0.5, confidence: 1 };
    draft.scalars.ache = { value: 0.5, confidence: 1 };
    draft.scalars.pace = { value: 0.5, confidence: 1 };
    draft.feeling.tone = [tag("melancholy")];
    const profile = buildItemProfile(baseItem(), draft, { attributeSource: "ai", completeness: "strict" });
    expect(profile.profile_version).toBe(PROFILE_VERSION);
    expect(profile.vocabulary_version).toBe("v2");
    for (const attribute of profile.story) {
      if (attribute.key.includes(".")) expect(familyOf(attribute.key)).toBe("story");
    }
    for (const attribute of profile.feeling) {
      if (attribute.key.includes(".")) expect(familyOf(attribute.key)).toBe("feeling");
    }
  });

  it("B: the vector keeps only weight×confidence ≥ 0.05, rounded to 4 decimals, and never craft keys", () => {
    const draft = emptyDraft();
    draft.story.theme = [{ key: "grief", weight: 0.1, confidence: 0.49 }]; // 0.049 → absent
    draft.story.arc = [{ key: "quest", weight: 0.1, confidence: 0.5 }]; // 0.05 → present
    draft.scalars["moral-complexity"] = { value: 0.6, confidence: 1 }; // story scalar 0.6
    draft.scalars.intensity = { value: 0.7, confidence: 1 }; // feeling scalar 0.7
    draft.craft = [{ key: "visual.lush", weight: 0.9, confidence: 0.9 }];
    const profile = buildItemProfile(baseItem(), draft, { attributeSource: "ai", completeness: "lenient" });
    expect(profile.vector.story["theme.grief"]).toBeUndefined();
    expect(profile.vector.story["arc.quest"]).toBe(0.05);
    expect(profile.vector.story["moral-complexity"]).toBe(0.6);
    expect(profile.vector.feeling.intensity).toBe(0.7);
    expect(profile.vector.story["visual.lush"]).toBeUndefined();
    expect(profile.vector.feeling["visual.lush"]).toBeUndefined();
  });

  it("C: the schema rejects unknown story keys, out-of-range numbers, over-cap arrays and a long premise", () => {
    const bad = (mutate: (draft: ProfileDraft) => void) => {
      const draft = emptyDraft();
      mutate(draft);
      expect(() => ProfileDraftSchema.parse(draft)).toThrow();
    };
    bad((d) => { (d.story as Record<string, unknown>).nothing = [tag("x")]; });
    bad((d) => { d.story.theme = [{ key: "grief", weight: 1.2, confidence: 0.5 }]; });
    bad((d) => { d.story.theme = [{ key: "grief", weight: 0.5, confidence: -0.1 }]; });
    bad((d) => {
      d.story.theme = [
        tag("grief"), tag("love"), tag("memory"), tag("home"), tag("time"),
      ];
    });
    bad((d) => { d.premise = "a".repeat(401); });
    // The same shape with in-range values parses.
    expect(ProfileDraftSchema.parse(emptyDraft())).toBeTruthy();
  });

  it("D: strict completeness demands exactly one stakes, one ending and both story scalars; lenient passes", () => {
    const draft = emptyDraft();
    draft.story.theme = [tag("grief")];
    expect(() => buildItemProfile(baseItem(), draft, { attributeSource: "ai", completeness: "strict" }))
      .toThrow(ProfileValidationError);
    try {
      buildItemProfile(baseItem(), draft, { attributeSource: "ai", completeness: "strict" });
    } catch (error) {
      const reasons = (error as ProfileValidationError).reasons.join(" | ");
      expect(reasons).toContain("stakes");
      expect(reasons).toContain("ending");
      expect(reasons).toContain("pace");
    }
    const profile = buildItemProfile(baseItem(), draft, { attributeSource: "ai", completeness: "lenient" });
    expect(profile.story.length).toBeGreaterThan(0);
  });

  it("E: frame merge — catalog frames enter at w 1.0 / c 0.9, higher w×c wins, ties keep catalog, top 3 kept", () => {
    // "noir" alone → frame.crime from catalog.
    const only = buildItemProfile(baseItem({ genre_tags: ["noir"] }), emptyDraft(), { attributeSource: "ai", completeness: "lenient" });
    const crime = only.story.find((a) => a.key === "frame.crime");
    expect(crime).toEqual({ key: "frame.crime", weight: 1, source: "catalog", confidence: 0.9 });

    // AI names frame.crime stronger → AI wins.
    const aiWins = emptyDraft();
    aiWins.story.frame = [{ key: "crime", weight: 1, confidence: 0.95 }];
    const p1 = buildItemProfile(baseItem({ genre_tags: ["noir"] }), aiWins, { attributeSource: "ai", completeness: "lenient" });
    const c1 = p1.story.find((a) => a.key === "frame.crime");
    expect(c1?.source).toBe("ai");
    expect(c1?.confidence).toBe(0.95);

    // AI at exactly 0.9 confidence → tie → catalog wins.
    const tie = emptyDraft();
    tie.story.frame = [{ key: "crime", weight: 1, confidence: 0.9 }];
    const p2 = buildItemProfile(baseItem({ genre_tags: ["noir"] }), tie, { attributeSource: "ai", completeness: "lenient" });
    const c2 = p2.story.find((a) => a.key === "frame.crime");
    expect(c2?.source).toBe("catalog");

    // Four candidates → top 3 by w×c, ties by key ascending.
    const four = emptyDraft();
    four.story.frame = [
      { key: "thriller", weight: 1, confidence: 0.8 }, // 0.8
      { key: "mystery", weight: 0.9, confidence: 0.8 }, // 0.72
      { key: "horror", weight: 0.9, confidence: 0.79 }, // 0.711
      { key: "sci-fi", weight: 0.9, confidence: 0.79 }, // 0.711, tie with horror → sci-fi wins the tie? key ascending: "horror" < "sci-fi"
    ];
    const p3 = buildItemProfile(baseItem({ genre_tags: [] }), four, { attributeSource: "ai", completeness: "lenient" });
    const frames = p3.story.filter((a) => a.key.startsWith("frame.")).map((a) => a.key).sort();
    expect(frames).toEqual(["frame.horror", "frame.mystery", "frame.thriller"]);

    // Provider-shaped tags are normalised (SPEC §1.2: normaliseTags first) before the
    // frame table, so TMDB's "sci-fi & fantasy" yields frame.sci-fi instead of nothing.
    const providerShaped = buildItemProfile(
      baseItem({ genre_tags: ["sci-fi & fantasy"] }),
      emptyDraft(),
      { attributeSource: "ai", completeness: "lenient" },
    );
    expect(providerShaped.story.map((a) => a.key)).toContain("frame.sci-fi");
    expect(providerShaped.story.find((a) => a.key === "frame.sci-fi")?.source).toBe("catalog");
  });

  it("F: craft — a movie keeps visual.lush, rejects prose.spare and a second visual value", () => {
    const ok = emptyDraft();
    ok.craft = [{ key: "visual.lush", weight: 0.8, confidence: 0.9 }];
    const p1 = buildItemProfile(baseItem(), ok, { attributeSource: "ai", completeness: "lenient" });
    expect(p1.form.craft.map((c) => c.key)).toEqual(["visual.lush"]);

    const wrongCategory = emptyDraft();
    wrongCategory.craft = [{ key: "prose.spare", weight: 0.8, confidence: 0.9 }];
    expect(() => buildItemProfile(baseItem(), wrongCategory, { attributeSource: "ai", completeness: "lenient" }))
      .toThrow(/prose\.spare/);

    const twice = emptyDraft();
    twice.craft = [tag("visual.lush"), { key: "visual.stark", weight: 0.7, confidence: 0.9 }];
    expect(() => buildItemProfile(baseItem(), twice, { attributeSource: "ai", completeness: "lenient" }))
      .toThrow(/visual/);
  });

  it("G: music caps AI confidence at 0.5 (vector included) and leaves band null", () => {
    const draft = emptyDraft();
    draft.feeling.tone = [{ key: "melancholy", weight: 0.8, confidence: 0.9 }];
    const item = baseItem({
      category: "music",
      genre_tags: [],
      metadata: { duration_seconds: 240 },
    });
    const profile = buildItemProfile(item, draft, { attributeSource: "ai", completeness: "lenient" });
    const tone = profile.feeling.find((a) => a.key === "tone.melancholy");
    expect(tone?.confidence).toBe(0.5);
    expect(profile.vector.feeling["tone.melancholy"]).toBeCloseTo(Math.round(0.8 * 0.5 * 10000) / 10000);
    expect(profile.form.band).toBeNull();
    expect(profile.form.minutes_to_finish).toBeNull();
  });

  it("H: a manual item forces premise null and profilerInput omits the overview", () => {
    const draft = emptyDraft();
    draft.premise = "A heist inside dreams.";
    const profile = buildItemProfile(baseItem({ source: "manual" }), draft, { attributeSource: "ai", completeness: "lenient" });
    expect(profile.premise).toBeNull();

    const input = profilerInput(baseItem({ source: "manual" }));
    expect(input).not.toContain("dream-sharing technology");
  });

  it("I: the praise guard drops a premise containing reception words to null without failing the profile", () => {
    const draft = emptyDraft();
    draft.premise = "An acclaimed masterpiece about a thief who steals secrets.";
    const profile = buildItemProfile(baseItem(), draft, { attributeSource: "ai", completeness: "lenient" });
    expect(profile.premise).toBeNull();
    expect(profile.story.length).toBeGreaterThan(0);
  });

  it("J: form comes from metadata, never from the draft", () => {
    const profile = buildItemProfile(baseItem(), emptyDraft(), { attributeSource: "ai", completeness: "lenient" });
    expect(profile.form.minutes_to_finish).toBe(148);
    expect(profile.form.band).toBe(2); // 120–149 per SPEC §1.4
    expect(profile.form.craft).toEqual([]);
  });

  it("K: shuffling the draft's array order gives a deep-equal profile", () => {
    const a = emptyDraft();
    a.story.theme = [tag("grief"), tag("love", 0.7), tag("memory", 0.6)];
    a.story.arc = [tag("quest"), tag("descent", 0.7)];
    a.feeling.tone = [tag("melancholy"), tag("wistful", 0.7)];
    a.feeling.aftertaste = [tag("lingering"), tag("haunting", 0.7)];
    a.craft = [{ key: "visual.lush", weight: 0.8, confidence: 0.9 }, { key: "dialogue.sparse", weight: 0.6, confidence: 0.9 }];
    const reversed = structuredClone(a);
    for (const group of Object.keys(reversed.story) as Array<keyof ProfileDraft["story"]>) {
      if (Array.isArray(reversed.story[group])) (reversed.story[group] as unknown[]).reverse();
    }
    for (const group of Object.keys(reversed.feeling) as Array<keyof ProfileDraft["feeling"]>) {
      (reversed.feeling[group] as unknown[]).reverse();
    }
    reversed.craft.reverse();
    const p1 = buildItemProfile(baseItem(), a, { attributeSource: "ai", completeness: "lenient" });
    const p2 = buildItemProfile(baseItem(), reversed, { attributeSource: "ai", completeness: "lenient" });
    expect(p2).toEqual(p1);
  });

  it("L2: profilerInput includes anime film runtime, which the form calculation also uses", () => {
    const item = baseItem({
      category: "anime",
      genre_tags: ["animation", "action"],
      metadata: { runtime_minutes: 106, overview: "A hand-drawn feature." },
    });
    const input = profilerInput(item);
    expect(input).toContain("106");
    // And the same number drives the form, so input and form agree.
    const profile = buildItemProfile(item, emptyDraft(), { attributeSource: "ai", completeness: "lenient" });
    expect(profile.form.minutes_to_finish).toBe(106);
  });

  it("L: profilerInput includes the allowed fields and never leaks priors, images, weights, ids or injected popularity", () => {
    const item = baseItem({
      subtitle: "A Christopher Nolan film",
      feel_prior: { "tone.dark": 0.9 },
      image_url: "https://example.com/poster.jpg",
      metadata: {
        runtime_minutes: 148,
        overview: "A thief who steals corporate secrets.",
        encounter_weight: 0.8,
        popularity: 99.5,
        vote_average: 8.4,
      },
    });
    const input = profilerInput(item);
    expect(input).toContain("Inception");
    expect(input).toContain("Christopher Nolan");
    expect(input).toContain("sci-fi");
    expect(input).toContain("A thief who steals corporate secrets.");
    expect(input).not.toContain("feel_prior");
    expect(input).not.toContain("tone.dark");
    expect(input).not.toContain("image");
    expect(input).not.toContain("encounter_weight");
    expect(input).not.toContain("external_id");
    expect(input).not.toContain("popularity");
    expect(input).not.toContain("vote_average");
    expect(input).not.toContain("99.5");
  });

  it("M: CRAFT and isCraftKey are exact-match per category", () => {
    expect(isCraftKey("movie", "visual.lush")).toBe(true);
    expect(isCraftKey("movie", "visual")).toBe(false);
    expect(isCraftKey("movie", "visual.lush.x")).toBe(false);
    expect(isCraftKey("movie", "visual.Lush")).toBe(false);
    expect(isCraftKey("movie", "energy.high")).toBe(false); // music keys invalid for movie
    expect(isCraftKey("music", "energy.high")).toBe(true);
    expect(isCraftKey("book", "prose.spare")).toBe(true);
    expect(isCraftKey("anime", "filler.light")).toBe(true);
    expect(isCraftKey("tv", "hook.slow")).toBe(true);
    for (const [category, groups] of Object.entries(CRAFT)) {
      for (const [group, values] of Object.entries(groups)) {
        for (const value of values) expect(`${group}.${value}`).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
        void category;
      }
    }
  });

  it("PROFILE_SYSTEM_PROMPT names every group, the caps, and the no-praise rules", () => {
    expect(PROFILE_SYSTEM_PROMPT).toContain("- theme (max 4): grief");
    expect(PROFILE_SYSTEM_PROMPT).toContain("- aftertaste (max 3): lingering");
    expect(PROFILE_SYSTEM_PROMPT).toContain("- movie: visual (naturalistic");
    expect(PROFILE_SYSTEM_PROMPT).toContain("Never use reviews, ratings, popularity, awards");
    expect(PROFILE_SYSTEM_PROMPT).toContain("ending");
    expect(PROFILE_SYSTEM_PROMPT).toContain("400");
  });
});
