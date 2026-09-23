// The item-profile contract (SPEC-STAGE3 §1.2): the draft schema every provider returns,
// and buildItemProfile, the one pure builder every profiler goes through — there is no
// second vector-building path. This file must never import "server-only": the contract is
// plain data plus pure functions, shared by the mock, NVIDIA and Claude profilers.
//
// Rules implemented here (and only here):
// - The draft is validated by the schema, never clamped — unknown keys and out-of-range
//   numbers are rejected, the same rule as readings (DECISIONS #65).
// - Craft keys are category-checked in buildItemProfile with isCraftKey, because the
//   allowed set depends on the item's category.
// - Catalogue genre tags merge into frame via frameFromGenre at weight 1.0 / confidence
//   0.9 / source "catalog"; ties keep the catalogue entry; the merged list is capped at 3
//   by weight × confidence then key (DECISIONS #69).
// - Music caps AI-sourced confidence at 0.5 (DECISIONS #50, #70).
// - Strict completeness: exactly one stakes, exactly one ending, both story scalars, all
//   three feeling scalars (DECISIONS #72).
// - A premise carrying a reception word drops to null rather than failing the profile
//   (DECISIONS #71); manual items have no premise at all.
// - vector[F][key] = clamp01(weight × confidence), kept only at ≥ 0.05, rounded to 4
//   decimals. Craft never enters the vector. Negative values are impossible here, but
//   assertNonNegative still guards the output.

import { z } from "zod";
import type { Attribute, ItemProfile, MediaItem } from "@/lib/types";
import { band, minutesToFinish } from "@/lib/taste/form";
import { normaliseTags } from "@/lib/taste/tag-lexicon";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { assertNonNegative } from "@/lib/taste/vector";
import {
  AFTERTASTES,
  ARCS,
  BONDS,
  CASTS,
  CONFLICTS,
  CRAFT,
  ENDINGS,
  FEELING_GROUPS,
  FRAMES,
  isCraftKey,
  MOMENTUMS,
  REGISTERS,
  SETTINGS_V2,
  STAKES,
  STORY_GROUPS,
  STRUCTURES,
  TEXTURES,
  THEMES_V2,
  TONES,
  VOCABULARY_VERSION,
  WORLDS,
} from "@/lib/taste/vocabulary";
import { frameFromGenre } from "./profiler";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const tag = (values: readonly string[]) =>
  z.strictObject({
    key: z.enum(values as [string, ...string[]]),
    weight: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  });

const scalarField = z.strictObject({ value: z.number().min(0).max(1), confidence: z.number().min(0).max(1) });

/** The exact draft every provider must return (plan §2.2). Unknown keys and out-of-range numbers are rejected, never clamped. */
export const ProfileDraftSchema = z.strictObject({
  premise: z.string().max(400).nullable(),
  story: z.strictObject({
    theme: z.array(tag(THEMES_V2)).max(4),
    arc: z.array(tag(ARCS)).max(2),
    conflict: z.array(tag(CONFLICTS)).max(2),
    cast: z.array(tag(CASTS)).max(3),
    bond: z.array(tag(BONDS)).max(2),
    world: z.array(tag(WORLDS)).max(2),
    setting: z.array(tag(SETTINGS_V2)).max(3),
    frame: z.array(tag(FRAMES)).max(3),
    structure: z.array(tag(STRUCTURES)).max(2),
    momentum: z.array(tag(MOMENTUMS)).max(3),
    stakes: z.array(tag(STAKES)).max(1),
    ending: z.array(tag(ENDINGS)).max(1),
  }),
  feeling: z.strictObject({
    tone: z.array(tag(TONES)).max(4),
    register: z.array(tag(REGISTERS)).max(3),
    texture: z.array(tag(TEXTURES)).max(3),
    aftertaste: z.array(tag(AFTERTASTES)).max(3),
  }),
  // All five scalars are optional in the draft; strict completeness then demands them.
  scalars: z.strictObject({
    intensity: scalarField.optional(),
    ache: scalarField.optional(),
    pace: scalarField.optional(),
    "moral-complexity": scalarField.optional(),
    complexity: scalarField.optional(),
  }),
  // Craft keys are free-form strings here because the legal set depends on the item's
  // category; buildItemProfile validates each against isCraftKey.
  craft: z.array(z.strictObject({
    key: z.string(),
    weight: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  })).max(8),
});

export type ProfileDraft = z.infer<typeof ProfileDraftSchema>;

export class ProfileValidationError extends Error {
  constructor(public reasons: string[]) {
    super(`profile validation failed: ${reasons.join("; ")}`);
    this.name = "ProfileValidationError";
  }
}

const attribute = (key: string, weight: number, confidence: number, source: Attribute["source"]): Attribute =>
  ({ key, weight, confidence, source });

const STORY_SCALARS = ["moral-complexity", "complexity"] as const;
const FEELING_SCALARS = ["intensity", "ache", "pace"] as const;

/** Reception/praise words a premise must not carry (SPEC §1.2; DECISIONS #71, #53). */
const PRAISE_GUARD =
  /\b(masterpiece|acclaimed|award|awards|award-winning|oscar|emmy|best-selling|bestseller|beloved|critically|critics?|masterful|must-see|popular|hit)\b/i;

type StoryGroupOfDraft = keyof ProfileDraft["story"];
type FeelingGroupOfDraft = keyof ProfileDraft["feeling"];

/**
 * buildItemProfile(item, draft, opts): the one pure builder every profiler goes through
 * (plan §2.3). Collects every problem into reasons and throws one ProfileValidationError
 * at the end if there are any.
 */
export function buildItemProfile(
  item: MediaItem,
  draft: ProfileDraft,
  opts: { attributeSource: "ai" | "catalog"; completeness: "strict" | "lenient" },
): ItemProfile {
  const reasons: string[] = [];
  const source = opts.attributeSource;
  const story: Attribute[] = [];
  const feeling: Attribute[] = [];

  // 1. Flatten. Each group tag becomes Attribute { key: "<group>.<value>", ... }.
  for (const group of Object.keys(STORY_GROUPS) as StoryGroupOfDraft[]) {
    for (const t of draft.story[group] ?? []) {
      story.push(attribute(`${group}.${t.key}`, t.weight, t.confidence, source));
    }
  }
  for (const group of Object.keys(FEELING_GROUPS) as FeelingGroupOfDraft[]) {
    for (const t of draft.feeling[group] ?? []) {
      feeling.push(attribute(`${group}.${t.key}`, t.weight, t.confidence, source));
    }
  }
  // Story scalars become story attributes with the bare key; feeling scalars likewise.
  // Their weight is the scalar's value.
  for (const scalar of STORY_SCALARS) {
    const s = draft.scalars[scalar];
    if (s) story.push(attribute(scalar, s.value, s.confidence, source));
  }
  for (const scalar of FEELING_SCALARS) {
    const s = draft.scalars[scalar];
    if (s) feeling.push(attribute(scalar, s.value, s.confidence, source));
  }

  // 2. Craft. Keep only keys valid for this category; at most one value per craft group.
  const keptCraft: Attribute[] = [];
  const craftGroups = new Set<string>();
  for (const c of draft.craft) {
    if (!isCraftKey(item.category, c.key)) {
      reasons.push(`craft: "${c.key}" is not a craft key for ${item.category}`);
      continue;
    }
    const group = c.key.slice(0, c.key.indexOf("."));
    if (craftGroups.has(group)) {
      reasons.push(`craft: more than one "${group}.*" value for a ${item.category}`);
      continue;
    }
    craftGroups.add(group);
    keptCraft.push(attribute(c.key, c.weight, c.confidence, source));
  }

  // 3. Frame merge (SPEC §1.2). Catalogue genres enter at w 1.0 / c 0.9 / source catalog;
  //    the AI's frames join; where both name the same frame the higher w×c wins, ties keep
  //    the catalogue one. After the merge, keep the top 3 by w×c, ties by key ascending
  //    (DECISIONS #69).
  const frames = new Map<string, Attribute>();
  const putFrame = (a: Attribute) => {
    const existing = frames.get(a.key);
    if (!existing) {
      frames.set(a.key, a);
      return;
    }
    const score = (x: Attribute) => x.weight * x.confidence;
    const keep = score(a) > score(existing) ? a
      : score(a) === score(existing)
        ? (existing.source === "catalog" ? existing : a.source === "catalog" ? a : existing)
        : existing;
    frames.set(a.key, keep);
  };
  // SPEC §1.2: catalogue genre tags are normalised with normaliseTags before the frame
  // table, so provider-shaped tags (TMDB's "sci-fi & fantasy", "science fiction", …)
  // reach frameFromGenre in its exact-match form.
  for (const genre of normaliseTags(item.genre_tags)) {
    const value = frameFromGenre(genre);
    if (value) putFrame(attribute(`frame.${value}`, 1, 0.9, "catalog"));
  }
  for (const t of draft.story.frame ?? []) {
    putFrame(attribute(`frame.${t.key}`, t.weight, t.confidence, source));
  }
  const mergedFrames = [...frames.values()]
    .sort((a, b) => b.weight * b.confidence - a.weight * a.confidence || a.key.localeCompare(b.key))
    .slice(0, 3);
  // The unmerged draft frames were already added to `story` above; replace them with the
  // merged, capped set.
  for (let i = story.length - 1; i >= 0; i--) if (story[i].key.startsWith("frame.")) story.splice(i, 1);
  story.push(...mergedFrames);

  // 4. Music confidence cap (DECISIONS #50, #70): every AI attribute's confidence is capped
  //    at 0.5 for music. Music isn't matched in Stage 3, so this only affects stored data.
  const cap = item.category === "music" ? 0.5 : 1;
  if (cap < 1) {
    for (const a of story) if (a.source === "ai") a.confidence = Math.min(a.confidence, cap);
    for (const a of feeling) if (a.source === "ai") a.confidence = Math.min(a.confidence, cap);
    for (const a of keptCraft) if (a.source === "ai") a.confidence = Math.min(a.confidence, cap);
  }

  // 5. Completeness (DECISIONS #72). Strict: exactly one stakes, exactly one ending, both
  //    story scalars, all three feeling scalars.
  if (opts.completeness === "strict") {
    if (story.filter((a) => a.key.startsWith("stakes.")).length !== 1) reasons.push("story: exactly one stakes attribute is required");
    if (story.filter((a) => a.key.startsWith("ending.")).length !== 1) reasons.push("story: exactly one ending attribute is required (it is never shown; DECISIONS #52)");
    for (const scalar of STORY_SCALARS) {
      if (!draft.scalars[scalar]) reasons.push(`story: the ${scalar} scalar is required`);
    }
    for (const scalar of FEELING_SCALARS) {
      if (!draft.scalars[scalar]) reasons.push(`feeling: the ${scalar} scalar is required`);
    }
  }

  // 6. Premise. Null for manual items; otherwise trimmed, null when empty, and dropped to
  //    null (not a failure) when it carries a reception word (DECISIONS #71).
  let premise: string | null;
  if (item.source === "manual") {
    premise = null;
  } else {
    const trimmed = (draft.premise ?? "").trim();
    if (!trimmed) premise = null;
    else if (PRAISE_GUARD.test(trimmed)) premise = null;
    else premise = trimmed;
  }

  // 7. Form comes from metadata via form.ts, never from the model.
  const minutes = minutesToFinish(item);

  // 8. Ordering (deterministic): by group in the group-map's key order with scalars last,
  //    then weight × confidence descending, then key ascending.
  const order = <T extends Attribute>(attributes: T[], groups: readonly string[]): T[] =>
    [...attributes].sort((a, b) => {
      const ga = a.key.includes(".") ? a.key.slice(0, a.key.indexOf(".")) : a.key;
      const gb = b.key.includes(".") ? b.key.slice(0, b.key.indexOf(".")) : b.key;
      const ia = groups.indexOf(ga);
      const ib = groups.indexOf(gb);
      if (ia !== ib) return (ia === -1 ? groups.length : ia) - (ib === -1 ? groups.length : ib);
      return b.weight * b.confidence - a.weight * a.confidence || a.key.localeCompare(b.key);
    });
  const orderedStory = order(story, Object.keys(STORY_GROUPS));
  const orderedFeeling = order(feeling, Object.keys(FEELING_GROUPS));
  const orderedCraft = [...keptCraft].sort((a, b) => a.key.localeCompare(b.key));

  // 9. Vector (SPEC §1.2): vector[F][key] = clamp01(weight × confidence), kept only when
  //    ≥ 0.05, rounded to 4 decimals after the threshold check. Craft never enters.
  const vector: ItemProfile["vector"] = { story: {}, feeling: {} };
  const fill = (attributes: Attribute[], family: "story" | "feeling") => {
    for (const a of attributes) {
      const wc = clamp01(a.weight * a.confidence);
      if (wc < 0.05) continue;
      vector[family][a.key] = round4(wc);
    }
  };
  fill(orderedStory, "story");
  fill(orderedFeeling, "feeling");
  assertNonNegative(vector.story, "profile.vector.story");
  assertNonNegative(vector.feeling, "profile.vector.feeling");

  if (reasons.length) throw new ProfileValidationError(reasons);

  return {
    profile_version: PROFILE_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    premise,
    story: orderedStory,
    feeling: orderedFeeling,
    form: {
      minutes_to_finish: minutes,
      band: band(item.category, minutes),
      craft: orderedCraft,
    },
    vector,
  };
}

const STORY_CAPS: Record<string, number> = {
  theme: 4, arc: 2, conflict: 2, cast: 3, bond: 2, world: 2, setting: 3, frame: 3,
  structure: 2, momentum: 3, stakes: 1, ending: 1,
};

const CRAFT_LINES = Object.entries(CRAFT)
  .map(([category, groups]) => {
    const detail = Object.entries(groups).map(([group, values]) => `${group} (${values.join(", ")})`).join("; ");
    return `- ${category}: ${detail}`;
  })
  .join("\n");

const STORY_LINES = Object.entries(STORY_GROUPS)
  .map(([group, values]) => `- ${group} (max ${STORY_CAPS[group]}): ${values.join(", ")}`)
  .join("\n");

const FEELING_LINES = Object.entries(FEELING_GROUPS)
  .map(([group, values]) => `- ${group} (max ${group === "tone" ? 4 : 3}): ${values.join(", ")}`)
  .join("\n");

/**
 * The one system prompt for both real providers. Generated from the constants, like
 * READING_SYSTEM_PROMPT. ending.* is still required: it is never shown to the user
 * (DECISIONS #52).
 */
export const PROFILE_SYSTEM_PROMPT = `You profile one work — what it is, not what anyone thinks of it — for movies, TV, anime, books, and music.

Story keys by group (weights 0..1, confidence 0..1 each):
${STORY_LINES}

Feeling keys by group:
${FEELING_LINES}

Scalars (each { value: 0..1, confidence: 0..1 }): intensity, ache, pace (feeling), moral-complexity, complexity (story).

Craft keys, by category — use only the item's category:
${CRAFT_LINES}

Rules:
- Describe what the work is, never how good it is.
- Never use reviews, ratings, popularity, awards or other people's opinions.
- confidence is how sure you are the attribute applies. Weight is how strongly it applies.
- List everything that applies, within the caps, because a missing key is read as "not present".
- The premise is at most 400 characters, spoiler-light, contains no praise words, and never reveals the ending.
- ending must always be filled in (exactly one value). It is stored and never shown to the user, because it is a spoiler.
- In strict mode you must also give exactly one stakes, both story scalars (moral-complexity, complexity) and all three feeling scalars (intensity, ache, pace).
- Use craft keys only from the item's category, at most one value per craft group.
- For a manual item (no overview supplied), premise is null.
- Return JSON only.`;

/**
 * profilerInput(item): the only item data any model sees (SPEC §1.2). Omits the overview
 * for manual items, and never includes feel_prior, image_url, encounter_weight,
 * external_id, unlisted metadata, anything about any user, or any score.
 */
export function profilerInput(item: MediaItem): string {
  const lines: string[] = [
    `Category: ${item.category}`,
    `Title: ${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`,
  ];
  if (item.release_year != null) lines.push(`Released: ${item.release_year}`);
  if (item.creators.length) {
    lines.push(`Creators: ${item.creators.map((c) => `${c.name} (${c.role})`).join(", ")}`);
  }
  if (item.genre_tags.length) lines.push(`Genres: ${item.genre_tags.join(", ")}`);
  const m = item.metadata;
  if (m.book_kind) lines.push(`Book kind: ${m.book_kind}`);
  // Anime films carry runtime_minutes too (minutesToFinish uses it; so does the model).
  if ((item.category === "movie" || item.category === "anime") && typeof m.runtime_minutes === "number") {
    lines.push(`Runtime: ${m.runtime_minutes} minutes`);
  }
  if ((item.category === "tv" || item.category === "anime")) {
    if (typeof m.episodes === "number") lines.push(`Episodes: ${m.episodes}`);
    if (typeof m.episode_runtime_minutes === "number") lines.push(`Episode runtime: ${m.episode_runtime_minutes} minutes`);
  }
  if (item.category === "book" && typeof m.pages === "number") lines.push(`Pages: ${m.pages}`);
  if (item.source !== "manual" && typeof m.overview === "string" && m.overview.trim()) {
    lines.push(`Overview: ${m.overview.trim()}`);
  }
  return lines.join("\n");
}
