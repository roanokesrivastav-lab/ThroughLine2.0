// Tag normalisation for the rule-based recommender.
//
// Four providers disagree about what a genre is. TMDB has 19 fixed buckets,
// Open Library has loose subjects, MusicBrainz has folksonomy tags written by
// strangers, and the built-in canon has hand-written ones. Raw string overlap
// across those is close to useless, so everything is normalised through here.
//
// Nothing in this file is a quality judgement and nothing counts how many other
// people used a tag. Specificity is about how much a match *tells you*: two
// people who both like "indie folk" have far more in common than two who both
// like "pop".

/** Variants that mean the same thing. Left side is already lowercased and trimmed. */
export const TAG_SYNONYMS: Record<string, string> = {
  "science fiction": "sci-fi",
  "science-fiction": "sci-fi",
  scifi: "sci-fi",
  sf: "sci-fi",
  "sci fi": "sci-fi",
  "sci-fi & fantasy": "sci-fi",
  "action & adventure": "action",
  "war & politics": "war",
  "hip-hop": "hip hop",
  hiphop: "hip hop",
  rap: "hip hop",
  "rhythm and blues": "r&b",
  rnb: "r&b",
  "r and b": "r&b",
  "singer songwriter": "singer-songwriter",
  "coming of age": "coming-of-age",
  bildungsroman: "coming-of-age",
  autobiography: "memoir",
  autobiographical: "memoir",
  "short story": "short stories",
  poems: "poetry",
  poem: "poetry",
  humour: "comedy",
  humor: "comedy",
  comic: "comedy",
  funny: "comedy",
  suspense: "thriller",
  "detective": "mystery",
  "film noir": "noir",
  "psychological thriller": "psychological",
  "slice-of-life": "slice of life",
  "indie-folk": "indie folk",
  "indie-rock": "indie rock",
  "synthpop": "synth-pop",
  "synth pop": "synth-pop",
  "triphop": "trip hop",
  "trip-hop": "trip hop",
  "art-rock": "art rock",
  "post rock": "post-rock",
  "alt rock": "alternative",
  "alternative rock": "alternative",
  "singer/songwriter": "singer-songwriter",
  "non fiction": "non-fiction",
  nonfiction: "non-fiction",
  biographical: "biography",
  historical_fiction: "historical",
  "historical fiction": "historical",
};

/**
 * Tags that carry no information about taste. Dropped entirely rather than
 * down-weighted, because a match on them is noise, not a weak signal.
 */
export const TAG_STOPLIST = new Set([
  "drama",
  "fiction",
  "novel",
  "novels",
  "classic",
  "classics",
  "general",
  "various",
  "misc",
  "miscellaneous",
  "music",
  "tv movie",
  "kids",
  "news",
  "reality",
  "soap",
  "talk",
  "unknown",
  "other",
  "book",
  "books",
  "film",
  "movie",
  "seen",
  "favourites",
  "favorites",
]);

/**
 * How much a match on this tag tells you, 0..1. Broad tags still count, but a
 * shared "indie folk" should not be worth the same as a shared "rock".
 * Unlisted tags default to DEFAULT_SPECIFICITY.
 */
export const TAG_SPECIFICITY: Record<string, number> = {
  // Broad: true but nearly always true.
  rock: 0.4,
  pop: 0.4,
  comedy: 0.45,
  action: 0.45,
  adventure: 0.45,
  family: 0.45,
  animation: 0.45,
  literary: 0.5,
  alternative: 0.5,
  children: 0.5,
  fable: 0.55,
  indie: 0.5,
  "non-fiction": 0.5,

  // Middling: a real orientation.
  folk: 0.75,
  jazz: 0.8,
  blues: 0.75,
  classical: 0.8,
  electronic: 0.7,
  "hip hop": 0.75,
  "r&b": 0.75,
  country: 0.75,
  dance: 0.7,
  "sci-fi": 0.75,
  fantasy: 0.7,
  horror: 0.8,
  mystery: 0.7,
  western: 0.8,
  war: 0.7,
  crime: 0.7,
  thriller: 0.65,
  romance: 0.7,
  history: 0.65,
  biography: 0.7,
  documentary: 0.75,
  philosophy: 0.8,
  sports: 0.8,
  supernatural: 0.7,
  historical: 0.7,

  // Specific: a real fingerprint.
  "indie folk": 1,
  "indie rock": 0.9,
  "art rock": 0.95,
  "trip hop": 1,
  "synth-pop": 0.95,
  "baroque pop": 1,
  britpop: 1,
  americana: 0.95,
  "singer-songwriter": 0.9,
  "post-rock": 1,
  noir: 1,
  mecha: 1,
  "slice of life": 0.9,
  psychological: 0.9,
  dystopia: 0.95,
  "coming-of-age": 0.9,
  memoir: 0.9,
  essays: 0.95,
  poetry: 0.95,
  "short stories": 0.9,
  grief: 0.95,
  nature: 0.8,
};

export const DEFAULT_SPECIFICITY = 0.65;

/**
 * Broader tags a specific one also implies. Someone who loves indie folk has
 * told you something about folk. Parents are credited at PARENT_DECAY.
 */
export const TAG_PARENTS: Record<string, string[]> = {
  "indie folk": ["folk", "indie"],
  "indie rock": ["rock", "indie"],
  "art rock": ["rock"],
  britpop: ["rock"],
  "post-rock": ["rock"],
  alternative: ["rock"],
  "synth-pop": ["pop", "electronic"],
  "baroque pop": ["pop"],
  "trip hop": ["electronic", "hip hop"],
  dance: ["electronic"],
  americana: ["folk", "country"],
  "singer-songwriter": ["folk"],
  blues: ["jazz"],
  noir: ["crime"],
  psychological: ["thriller"],
  mecha: ["sci-fi"],
  dystopia: ["sci-fi"],
  supernatural: ["fantasy"],
  memoir: ["non-fiction"],
  biography: ["non-fiction"],
  essays: ["non-fiction"],
  philosophy: ["non-fiction"],
  history: ["non-fiction"],
  documentary: ["non-fiction"],
  historical: ["history"],
  "short stories": ["literary"],
  poetry: ["literary"],
};

export const PARENT_DECAY = 0.6;

/**
 * Lowercase, de-punctuate and canonicalise one raw provider tag.
 * Returns null when the tag carries nothing worth matching on.
 */
export function normaliseTag(raw: string): string | null {
  if (!raw) return null;
  let t = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9&\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  t = TAG_SYNONYMS[t] ?? t;
  // Re-check after the synonym hop, since a synonym can land on a stoplisted tag.
  if (TAG_STOPLIST.has(t)) return null;
  if (t.length < 2 || t.length > 40) return null;
  return t;
}

export function tagSpecificity(tag: string): number {
  return TAG_SPECIFICITY[tag] ?? DEFAULT_SPECIFICITY;
}

/**
 * The tag itself plus the broader tags it implies, each with a multiplier.
 * Single level only: parents of parents are not walked, because the decay
 * compounds into noise and the graph is hand-written and shallow by design.
 */
export function tagFamily(tag: string): Array<{ tag: string; factor: number }> {
  const out = [{ tag, factor: 1 }];
  for (const parent of TAG_PARENTS[tag] ?? []) {
    if (TAG_STOPLIST.has(parent)) continue;
    out.push({ tag: parent, factor: PARENT_DECAY });
  }
  return out;
}

/** Normalise a provider's whole tag array, de-duplicated, order preserved. */
export function normaliseTags(raw: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw ?? []) {
    const t = normaliseTag(r);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Too broad to be worth calling a phase. Phase detection needs a tag to mean
 * something on its own; the recommender can still use these at low weight.
 * Shared from here so the two rules cannot drift apart.
 */
export function isTooBroadForPhases(tag: string): boolean {
  return TAG_STOPLIST.has(tag) || tagSpecificity(tag) < 0.6;
}

/** Prose form for explanations: "folk and singer-songwriter". */
export function listTags(tags: string[]): string {
  if (tags.length === 0) return "";
  if (tags.length === 1) return tags[0];
  return `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}`;
}
