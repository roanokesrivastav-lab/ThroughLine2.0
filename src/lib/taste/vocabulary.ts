// The shared, category-agnostic emotional vocabulary. Every extraction is
// stamped with VOCABULARY_VERSION so a future vocabulary can be reprocessed
// without touching the user's raw words.

// Pinned to v1 until the extractors emit v2 in the same commit. Four write paths stamp
// this constant onto live rows (server/extraction.ts, extractor.ts, nvidia.ts,
// mock-extractor.ts) and the re-read route keys off extractor, not version, so a premature
// bump would mislabel real data permanently with no self-heal. See DECISIONS #62.
export const VOCABULARY_VERSION = "v1";

/** The vocabulary the v2 lists below describe; stamped onto item profiles and v2 readings. */
export const VOCABULARY_V2_VERSION = "v2";

export const TONES = [
  "warm", "tender", "bleak", "playful", "wry", "earnest", "eerie", "lush",
  "austere", "cold", "wistful", "fierce", "serene", "restless", "romantic", "melancholy",
] as const;

export const REGISTERS = [
  "intimate", "epic", "quiet", "loud", "meditative", "propulsive", "confessional", "cerebral",
] as const;

export const TEXTURES = [
  "spare", "dense", "dreamlike", "gritty", "ornate", "raw", "polished", "hazy",
] as const;

export const AFTERTASTES = [
  "lingering", "haunting", "comforting", "unsettling", "bittersweet", "cathartic",
  "hopeful", "numb", "energized", "devastating",
] as const;

export const THEMES = [
  "grief", "love", "memory", "loneliness", "growing-up", "obsession", "family", "home",
  "faith", "violence", "class", "time", "identity", "freedom", "death", "friendship",
  "art", "nature", "power", "desire", "survival", "justice", "madness", "wonder",
] as const;

export const SCALARS = ["intensity", "ache", "pace"] as const;

export type Tone = (typeof TONES)[number];
export type Register = (typeof REGISTERS)[number];
export type Texture = (typeof TEXTURES)[number];
export type Aftertaste = (typeof AFTERTASTES)[number];
export type Theme = (typeof THEMES)[number];

export const GROUPS = {
  tone: TONES,
  register: REGISTERS,
  texture: TEXTURES,
  aftertaste: AFTERTASTES,
  theme: THEMES,
} as const;
export type Group = keyof typeof GROUPS;

/** Weight of each group when comparing two vectors. Themes and aftertastes are what actually bridge media. */
export const GROUP_WEIGHTS: Record<Group | "scalar", number> = {
  theme: 1.0,
  aftertaste: 1.0,
  tone: 0.9,
  register: 0.55,
  texture: 0.55,
  scalar: 0.5,
};

// ---------------------------------------------------------------------------
// Vocabulary v2 (SPEC-STAGE3 §1.1): two disjoint families, story and feeling.
// The feeling lists are exactly v1's; the story lists are new except for theme,
// which moves found-family to bond. The two families share no key.
// ---------------------------------------------------------------------------

/** v2 theme: exactly the ATTRIBUTES 1B list minus found-family (41 values). */
export const THEMES_V2 = [
  "grief", "love", "memory", "loneliness", "growing-up", "obsession", "family", "home",
  "faith", "violence", "class", "time", "identity", "freedom", "death", "friendship",
  "art", "nature", "power", "desire", "survival", "justice", "madness", "wonder",
  "ambition", "destiny-vs-choice", "expectation", "exploitation", "humanitys-limits", "war",
  "revenge", "redemption", "sacrifice", "belonging", "duty", "truth-and-lies", "corruption",
  "legacy", "isolation", "technology", "otherness",
] as const;

export const ARCS = [
  "transformation", "characters-changing-each-other", "parallels-and-foils", "self-determination",
  "breaking-expectations", "coming-of-age", "rise-and-fall", "redemption-arc", "descent",
  "quest", "homecoming",
] as const;

export const CONFLICTS = [
  "vs-self", "vs-person", "vs-society", "vs-system", "vs-nature", "vs-fate", "vs-the-unknown",
] as const;

export const CASTS = [
  "ensemble", "sprawling-cast", "single-protagonist", "duo", "morally-grey",
  "every-character-a-lead", "antihero", "underdog",
] as const;

export const BONDS = [
  "found-family", "rivals", "mentor-student", "siblings", "parent-child", "friendship", "partners",
] as const;

export const WORLDS = ["lived-in", "systemic", "mythic", "grounded", "hostile", "intimate-scale"] as const;

export const SETTINGS_V2 = [
  "contemporary", "historical", "near-future", "far-future", "secondary-world", "timeless",
  "urban", "rural", "school", "workplace", "wartime", "space",
] as const;

export const FRAMES = [
  "realism", "fantasy", "sci-fi", "horror", "crime", "mystery", "thriller", "romance", "comedy",
  "adventure", "slice-of-life", "satire",
] as const;

export const STRUCTURES = [
  "linear", "nonlinear", "multiple-pov", "frame-story", "unreliable-narrator", "mystery-box",
  "anthology",
] as const;

export const MOMENTUMS = ["suspenseful", "unpredictable", "episodic-arcs", "twisty", "cliffhangers"] as const;

export const STAKES = ["personal", "community", "world", "cosmic"] as const;

export const ENDINGS = ["resolved", "open", "ambiguous", "bittersweet", "tragic", "triumphant"] as const;

/** Story scalars, v2: moral-complexity and complexity only (darkness/hope/humour/romance are gone). */
export const STORY_SCALARS = ["moral-complexity", "complexity"] as const;

export type StoryGroup =
  | "theme" | "arc" | "conflict" | "cast" | "bond" | "world"
  | "setting" | "frame" | "structure" | "momentum" | "stakes" | "ending";

export const STORY_GROUPS = {
  theme: THEMES_V2,
  arc: ARCS,
  conflict: CONFLICTS,
  cast: CASTS,
  bond: BONDS,
  world: WORLDS,
  setting: SETTINGS_V2,
  frame: FRAMES,
  structure: STRUCTURES,
  momentum: MOMENTUMS,
  stakes: STAKES,
  ending: ENDINGS,
} as const;

export type FeelingGroup = "tone" | "register" | "texture" | "aftertaste";

export const FEELING_GROUPS = {
  tone: TONES,
  register: REGISTERS,
  texture: TEXTURES,
  aftertaste: AFTERTASTES,
} as const;

/** The five feeling scalars a v2 reading may carry; item profiles use only the feeling three. */
export const READING_SCALARS = ["intensity", "ache", "pace", "moral-complexity", "complexity"] as const;

/** Group weights for the story family (SPEC §2.1). ending has weight 0: stored, never scored. */
export const G_STORY: Record<StoryGroup | "scalar", number> = {
  theme: 1.0,
  arc: 0.8,
  frame: 0.8,
  bond: 0.7,
  conflict: 0.6,
  cast: 0.6,
  world: 0.6,
  momentum: 0.6,
  setting: 0.5,
  structure: 0.5,
  stakes: 0.4,
  ending: 0,
  scalar: 0.5,
};

/** Group weights for the feeling family (SPEC §2.1). Exactly v1's GROUP_WEIGHTS minus theme. */
export const G_FEELING: Record<FeelingGroup | "scalar", number> = {
  aftertaste: 1.0,
  tone: 0.9,
  register: 0.55,
  texture: 0.55,
  scalar: 0.5,
};

/** The family a key belongs to, or null when it is neither (SPEC §1.1: the families share no key). */
export function familyOf(key: string): "story" | "feeling" | null {
  const group = key.split(".")[0];
  if (group === "theme" || group === "arc" || group === "conflict" || group === "cast" || group === "bond" || group === "world" || group === "setting" || group === "frame" || group === "structure" || group === "momentum" || group === "stakes" || group === "ending") return "story";
  if (group === "tone" || group === "register" || group === "texture" || group === "aftertaste") return "feeling";
  // Bare scalars: the feeling three are shared with v1; the story two are v2-only.
  if (key === "intensity" || key === "ache" || key === "pace") return "feeling";
  if (key === "moral-complexity" || key === "complexity") return "story";
  return null;
}

/**
 * Is this a well-formed key of the given family? Story keys are "group.value" from the v2
 * lists, plus the bare scalars moral-complexity and complexity. Feeling keys are exactly
 * what v1's isKnownKey accepts minus theme. (SPEC-STAGE3 §1.1.)
 */
export function isKnownKeyIn(key: string, family: "story" | "feeling"): boolean {
  if (family === "story") {
    if (key === "moral-complexity" || key === "complexity") return true;
    const [group, value] = key.split(".");
    const list = (STORY_GROUPS as Record<string, readonly string[]>)[group];
    return !!list && !!value && list.includes(value);
  }
  if ((SCALARS as readonly string[]).includes(key)) return true;
  const [group, value] = key.split(".");
  const list = (FEELING_GROUPS as Record<string, readonly string[]>)[group];
  return !!list && !!value && list.includes(value);
}

export function isKnownKey(key: string): boolean {
  if ((SCALARS as readonly string[]).includes(key)) return true;
  const [group, value] = key.split(".");
  const list = GROUPS[group as Group] as readonly string[] | undefined;
  return !!list && list.includes(value);
}

/** Human phrases for keys, used in explanations. Kept deliberately plain. */
const NOUN: Record<string, string> = {
  "tone.warm": "warmth", "tone.tender": "tenderness", "tone.bleak": "bleakness", "tone.playful": "playfulness",
  "tone.wry": "wry humour", "tone.earnest": "earnestness", "tone.eerie": "eeriness", "tone.lush": "lushness",
  "tone.austere": "austerity", "tone.cold": "coldness", "tone.wistful": "wistfulness", "tone.fierce": "ferocity",
  "tone.serene": "serenity", "tone.restless": "restlessness", "tone.romantic": "romance", "tone.melancholy": "melancholy",
  "register.intimate": "intimacy", "register.epic": "scale", "register.quiet": "quietness", "register.loud": "loudness",
  "register.meditative": "a meditative pull", "register.propulsive": "propulsion", "register.confessional": "confession",
  "register.cerebral": "a cerebral edge",
  "texture.spare": "spareness", "texture.dense": "density", "texture.dreamlike": "a dreamlike quality", "texture.gritty": "grit",
  "texture.ornate": "ornateness", "texture.raw": "rawness", "texture.polished": "polish", "texture.hazy": "haze",
  "aftertaste.lingering": "a lingering aftertaste", "aftertaste.haunting": "a haunting aftertaste",
  "aftertaste.comforting": "comfort", "aftertaste.unsettling": "unease", "aftertaste.bittersweet": "bittersweetness",
  "aftertaste.cathartic": "catharsis", "aftertaste.hopeful": "hope", "aftertaste.numb": "numbness",
  "aftertaste.energized": "a charge", "aftertaste.devastating": "devastation",
  intensity: "intensity", ache: "ache", pace: "pace",
};

export function describeKey(key: string, value?: number): string {
  if (key === "pace") return value !== undefined && value < 0.4 ? "a slow burn" : value !== undefined && value > 0.7 ? "a brisk pace" : "pace";
  if (key === "ache") return value !== undefined && value > 0.6 ? "a deep ache" : "ache";
  if (key === "intensity") return value !== undefined && value > 0.7 ? "intensity" : "a gentle intensity";
  if (NOUN[key]) return NOUN[key];
  const [group, v] = key.split(".");
  if (group === "theme") return v.replace("-", " ");
  // v2 story groups render as the value's own name, hyphens spaced ("coming-of-age" →
  // "coming of age"). Deliberately mechanical: richer per-word phrases are the explainer
  // work's to refine, not vocabulary's to invent.
  if (group && group in STORY_GROUPS) return v.replace(/-/g, " ");
  return v ?? key;
}

/** Adjective form for portrait sentences: "tender, wistful, slow-burning". */
export function adjective(key: string, value?: number): string {
  if (key === "pace") return value !== undefined && value < 0.4 ? "slow-burning" : "brisk";
  if (key === "ache") return "aching";
  if (key === "intensity") return "intense";
  const [group, v] = key.split(".");
  if (group === "theme") return `about ${v.replace("-", " ")}`;
  if (group && group in STORY_GROUPS) return v.replace(/-/g, " ");
  return v ?? key;
}
