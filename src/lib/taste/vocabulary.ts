// The shared, category-agnostic emotional vocabulary. Every extraction is
// stamped with VOCABULARY_VERSION so a future vocabulary can be reprocessed
// without touching the user's raw words.

export const VOCABULARY_VERSION = "v1";

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
  return v ?? key;
}

/** Adjective form for portrait sentences: "tender, wistful, slow-burning". */
export function adjective(key: string, value?: number): string {
  if (key === "pace") return value !== undefined && value < 0.4 ? "slow-burning" : "brisk";
  if (key === "ache") return "aching";
  if (key === "intensity") return "intense";
  const [group, v] = key.split(".");
  if (group === "theme") return `about ${v.replace("-", " ")}`;
  return v ?? key;
}
