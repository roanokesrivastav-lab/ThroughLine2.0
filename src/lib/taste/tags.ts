// The derived tag profile: what someone's own history says about the kinds of
// things they go for, in the providers' vocabulary rather than the app's.
//
// Nothing here is self-reported. Every weight comes from taps and entries the
// person already made, including the onboarding canon pass, which needs no
// special case: "loved it" writes an entry with a `loved` reaction and "seen it"
// writes one without, so loved tags outweigh seen tags on their own.
//
// Pinning and muting in Settings are the only declared inputs, and both are
// optional.

import type { Category, EntryWithContext, MediaItem, TagMatch } from "@/lib/types";
import { affinity } from "./affinity";
import { normaliseTags, tagFamily, tagSpecificity } from "./tag-lexicon";

export type TastePrefs = {
  /** Tags the user raised by hand. */
  pinned: string[];
  /** Tags the user never wants to see. Acts as a hard filter, not a penalty. */
  muted: string[];
  /** Candidate keys the user dismissed with "not for me". */
  hidden: string[];
};

export const EMPTY_TASTE_PREFS: TastePrefs = { pinned: [], muted: [], hidden: [] };

export type TagAffinity = {
  tag: string;
  /** 0..1, saturating in accumulated evidence. */
  weight: number;
  /** Raw accumulated evidence before saturation, kept so the breakdown can be argued with. */
  raw: number;
  categories: Category[];
  entryIds: string[];
  pinned: boolean;
};

export type CreatorAffinity = {
  key: string;
  name: string;
  role: string;
  category: Category;
  weight: number;
  entryIds: string[];
};

export type TagProfile = {
  tags: Map<string, TagAffinity>;
  creators: Map<string, CreatorAffinity>;
  muted: Set<string>;
  hidden: Set<string>;
  evidence: { entries: number; taggedEntries: number; notes: number; pinned: number };
};

export const CREATOR_ROLE: Record<Category, string> = {
  movie: "director",
  tv: "creator",
  anime: "creator",
  book: "author",
  music: "artist",
};

/** Affinity above this counts for a tag; below it counts against, dampened. */
const NEUTRAL = 0.5;
const NEGATIVE_DAMPING = 0.6;
/** Evidence needed for a tag to reach weight 0.5. */
const TAG_HALF_EVIDENCE = 2;
/** A pinned tag never sits below this. */
const PINNED_FLOOR = 0.8;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const saturate = (raw: number, half: number) => (raw <= 0 ? 0 : raw / (raw + half));

export function creatorKey(category: Category, name: string): string {
  return `${category}:${name.trim().toLowerCase()}`;
}

/**
 * A stable identity for a candidate. Recommendations often predate a real
 * media_items row, where the id is already "source:external_id"; once the item
 * is saved the id becomes a uuid, so fall back to the source pair to keep the
 * key the same on both sides of that change.
 */
export function candidateKey(item: Pick<MediaItem, "id" | "source" | "external_id">): string {
  return item.id.includes(":") ? item.id : `${item.source}:${item.external_id}`;
}

/** The creator that defines this item: the role for its category, else whoever is listed first. */
export function primaryCreator(item: MediaItem): { name: string; role: string } | null {
  const role = CREATOR_ROLE[item.category];
  const match = item.creators.find((c) => c.role === role) ?? item.creators[0];
  if (!match?.name?.trim()) return null;
  return { name: match.name.trim(), role: match.role || role };
}

/**
 * Build the tag and creator profile from a library. Deterministic: the same
 * library and prefs always produce the same profile.
 */
export function buildTagProfile(library: EntryWithContext[], prefs: TastePrefs = EMPTY_TASTE_PREFS): TagProfile {
  const muted = new Set(normaliseTags(prefs.muted));
  const hidden = new Set(prefs.hidden ?? []);
  const pinned = new Set(normaliseTags(prefs.pinned));

  const acc = new Map<string, { raw: number; categories: Set<Category>; entryIds: Set<string> }>();
  const creatorAcc = new Map<string, { name: string; role: string; category: Category; affinities: number[]; entryIds: string[] }>();

  let taggedEntries = 0;
  let notes = 0;

  const logged = library.filter((e) => e.entry.status !== "want");
  for (const e of logged) {
    const aff = affinity(e);
    // Above neutral counts for, below counts against with a lighter hand: one
    // abandoned thing should not wipe out a whole kind of thing.
    const contribution = aff >= NEUTRAL ? aff : -(NEUTRAL - aff) * NEGATIVE_DAMPING;

    if (e.reactions.some((r) => (r.raw_note ?? "").trim().length > 0)) notes++;

    const tags = normaliseTags(e.item.genre_tags);
    if (tags.length) taggedEntries++;
    for (const tag of tags) {
      for (const { tag: t, factor } of tagFamily(tag)) {
        if (muted.has(t)) continue;
        const slot = acc.get(t) ?? { raw: 0, categories: new Set<Category>(), entryIds: new Set<string>() };
        slot.raw += contribution * factor;
        slot.categories.add(e.item.category);
        if (contribution > 0) slot.entryIds.add(e.entry.id);
        acc.set(t, slot);
      }
    }

    const creator = primaryCreator(e.item);
    if (creator && aff > NEUTRAL) {
      const key = creatorKey(e.item.category, creator.name);
      const slot = creatorAcc.get(key) ?? { name: creator.name, role: creator.role, category: e.item.category, affinities: [], entryIds: [] };
      slot.affinities.push(aff);
      slot.entryIds.push(e.entry.id);
      creatorAcc.set(key, slot);
    }
  }

  const tags = new Map<string, TagAffinity>();
  for (const [tag, slot] of acc) {
    const weight = saturate(slot.raw, TAG_HALF_EVIDENCE);
    if (weight <= 0 && !pinned.has(tag)) continue;
    tags.set(tag, {
      tag,
      weight: pinned.has(tag) ? Math.max(weight, PINNED_FLOOR) : weight,
      raw: slot.raw,
      categories: [...slot.categories],
      entryIds: [...slot.entryIds],
      pinned: pinned.has(tag),
    });
  }
  // A pinned tag counts even when nothing in the library carries it yet.
  for (const tag of pinned) {
    if (muted.has(tag) || tags.has(tag)) continue;
    tags.set(tag, { tag, weight: PINNED_FLOOR, raw: 0, categories: [], entryIds: [], pinned: true });
  }

  const creators = new Map<string, CreatorAffinity>();
  for (const [key, slot] of creatorAcc) {
    const mean = slot.affinities.reduce((a, b) => a + b, 0) / slot.affinities.length;
    creators.set(key, {
      key,
      name: slot.name,
      role: slot.role,
      category: slot.category,
      weight: clamp01((mean * Math.sqrt(slot.affinities.length)) / 2),
      entryIds: slot.entryIds,
    });
  }

  return {
    tags,
    creators,
    muted,
    hidden,
    evidence: { entries: logged.length, taggedEntries, notes, pinned: pinned.size },
  };
}

export type { TagMatch } from "@/lib/types";

export type TagOverlap = {
  score: number;
  matched: TagMatch[];
  /** Fraction of the candidate's own identity the profile covers, 0..1. */
  coverage: number;
};

/** Matched tags needed for confidence to reach its halfway point. */
const OVERLAP_HALF_MATCHES = 2;
/** Confidence floor: a single strong match is already worth most of the score. */
const OVERLAP_CONFIDENCE_FLOOR = 0.65;

/**
 * How well a candidate's tags line up with the profile.
 *
 * Two halves, both meaningful on their own:
 *   coverage   — the specificity-weighted mean of how much the profile likes
 *                this item's own tags. Already a true 0..1 reading, and what
 *                stops a nine-tag item brute-forcing its way up on one match.
 *   confidence — rises with the number of distinct matches, from a high floor.
 *                Liking all four of something's tags is firmer evidence than
 *                liking its only one, but not four times firmer.
 */
export function tagOverlap(candidateTags: string[], profile: TagProfile): TagOverlap {
  const own = normaliseTags(candidateTags);
  if (own.length === 0) return { score: 0, matched: [], coverage: 0 };

  const matched = new Map<string, TagMatch>();
  let ownSpecificity = 0;
  let matchedSpecificity = 0;

  for (const tag of own) {
    const spec = tagSpecificity(tag);
    ownSpecificity += spec;
    let bestForThisTag = 0;
    for (const { tag: t, factor } of tagFamily(tag)) {
      const entry = profile.tags.get(t);
      if (!entry || entry.weight <= 0) continue;
      const contribution = entry.weight * tagSpecificity(t) * factor;
      bestForThisTag = Math.max(bestForThisTag, entry.weight * factor);
      const prev = matched.get(t);
      if (!prev || prev.contribution < contribution) {
        matched.set(t, { tag: t, via: tag, profileWeight: entry.weight, specificity: tagSpecificity(t), contribution });
      }
    }
    matchedSpecificity += spec * bestForThisTag;
  }

  const coverage = ownSpecificity > 0 ? clamp01(matchedSpecificity / ownSpecificity) : 0;
  const confidence = OVERLAP_CONFIDENCE_FLOOR + (1 - OVERLAP_CONFIDENCE_FLOOR) * saturate(matched.size, OVERLAP_HALF_MATCHES);
  return {
    score: clamp01(coverage * confidence),
    matched: [...matched.values()].sort((a, b) => b.contribution - a.contribution),
    coverage,
  };
}

/** The profile's affinity for whoever made this item, if any. */
export function creatorMatch(item: MediaItem, profile: TagProfile): CreatorAffinity | null {
  const creator = primaryCreator(item);
  if (!creator) return null;
  return profile.creators.get(creatorKey(item.category, creator.name)) ?? null;
}

/** Is any of this candidate's tags muted? Used as a hard filter, not a penalty. */
export function isMuted(candidateTags: string[], profile: TagProfile): boolean {
  if (profile.muted.size === 0) return false;
  return normaliseTags(candidateTags).some((t) => profile.muted.has(t));
}

/**
 * Tags present in the user's own library, strongest first. Seeds the Settings
 * picker so it offers their vocabulary rather than an abstract taxonomy.
 */
export function availableTags(profile: TagProfile, limit = 40): TagAffinity[] {
  return [...profile.tags.values()]
    .filter((t) => t.entryIds.length > 0 || t.pinned)
    .sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
