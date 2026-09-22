import type { AttributeVector, EntryWithContext, ExtractionPayload, ItemProfile, ReadingVector } from "@/lib/types";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { VOCABULARY_V2_VERSION } from "./vocabulary";
import { entrySpan } from "./when";
import { assertNonNegative, blend, isEmpty, scale, type Family } from "./vector";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How much the user loves this entry, 0..1. Built from what they tapped and wrote,
 * with the private score as a coarse, low-weight nudge — never the main signal.
 */
export function affinity(e: EntryWithContext): number {
  if (e.entry.status === "want") return 0;
  let a = e.entry.status === "dropped" ? 0.15 : 0.5;
  const dims = Object.assign({}, ...e.reactions.map((r) => r.dimensions ?? {}));
  if (dims.loved) a += 0.3;
  if (dims.moved_me) a += 0.18;
  if (dims.stuck_with_me) a += 0.18;
  if (dims.would_return) a += 0.14;
  if (dims.changed_perspective) a += 0.14;
  if (dims.comforted_me) a += 0.1;
  if (dims.challenged_me) a += 0.08;
  if (e.reactions.some((r) => (r.raw_note ?? "").trim().length > 20)) a += 0.08; // they bothered to write
  if (e.entry.private_score != null) a += ((e.entry.private_score - 5.5) / 10) * 0.3;
  for (const r of e.resurfaces) {
    if (r.response === "still_hits") a += 0.15;
    if (r.response === "doesnt_hit") a -= 0.35;
  }
  return clamp01(a);
}

export function hasStrongReaction(e: EntryWithContext): boolean {
  return affinity(e) >= 0.7;
}

/** The latest completed extraction for an entry, if any. */
export function latestExtraction(e: EntryWithContext): ExtractionPayload | null {
  const done = e.extractions
    .filter((x) => x.status === "done" && x.attributes)
    .sort((x, y) => (y.extracted_at ?? "").localeCompare(x.extracted_at ?? ""));
  return done[0]?.attributes ?? null;
}

/** Temporary projection that keeps the v1 engines useful while v2 rows coexist. */
function legacyCompatibleVector(x: EntryWithContext["extractions"][number]): AttributeVector | null {
  if (!x.vector) return null;
  if (x.vocabulary_version !== VOCABULARY_V2_VERSION) return x.vector as AttributeVector;
  const nested = x.vector as ReadingVector;
  if (!nested.feeling || typeof nested.feeling !== "object" || Array.isArray(nested.feeling)) return null;
  const out: AttributeVector = { ...nested.feeling };
  if (nested.story && typeof nested.story === "object" && !Array.isArray(nested.story)) {
    for (const [key, weight] of Object.entries(nested.story)) if (key.startsWith("theme.")) out[key] = weight;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The attribute vector that represents this entry for the user:
 * extracted attributes from their words (newest weighted highest), falling back
 * to a faint prior from the catalog when they have not written anything.
 */
export function entryVector(e: EntryWithContext): AttributeVector | null {
  const done = e.extractions
    .filter((x) => x.status === "done" && legacyCompatibleVector(x))
    .sort((x, y) => (y.extracted_at ?? "").localeCompare(x.extracted_at ?? ""));
  if (done.length) {
    const parts = done.map((x, i) => ({ v: legacyCompatibleVector(x)!, w: i === 0 ? 1 : 0.5 }));
    const v = blend(parts);
    if (e.item.feel_prior && !isEmpty(e.item.feel_prior)) {
      return blend([{ v, w: 1 }, { v: e.item.feel_prior, w: 0.25 }]);
    }
    return v;
  }
  if (e.item.feel_prior && !isEmpty(e.item.feel_prior)) return scale(e.item.feel_prior, 0.85);
  return null;
}

export function hasOwnWords(e: EntryWithContext): boolean {
  const noted = new Set(e.reactions.filter((r) => (r.raw_note ?? "").trim().length > 0).map((r) => r.id));
  return e.extractions.some((x) => x.status === "done" && noted.has(x.reaction_id));
}

export function bestQuote(e: EntryWithContext): string | null {
  const x = latestExtraction(e);
  if (x?.quote) return x.quote;
  const note = e.reactions.map((r) => r.raw_note?.trim()).find((n) => n && n.length > 0);
  if (!note) return null;
  const first = note.split(/(?<=[.!?])\s+/)[0];
  return first.length > 140 ? first.slice(0, 137) + "…" : first;
}

/** A single moment for ordering: the middle of the span the user named, else the day it was added. */
export function entryDate(e: EntryWithContext): Date {
  return entrySpan(e.entry)?.mid ?? new Date(e.entry.created_at);
}

// ---------------------------------------------------------------------------
// Stage 3 entry vector (SPEC-STAGE3 §4.2). Additive: the legacy entryVector above
// stays for the v1 engines (DECISIONS #60); the Stage 3 scorer reads the family
// version below.
// ---------------------------------------------------------------------------

/**
 * A profile is usable iff it exists, is done, and carries the current PROFILE_VERSION
 * (§1.2). The domain MediaItem carries only the profile itself — the loader attaches it
 * only when the row qualifies — so the version check is the guard here.
 */
export function usableProfile(item: EntryWithContext["item"]): ItemProfile | null {
  const p = item.profile;
  return p && p.profile_version === PROFILE_VERSION ? p : null;
}

/**
 * vec_F(e) per §4.2: the item profile's family vector blended with the person's own v2
 * readings — 0.8 reading / 0.2 profile when readings exist, the profile alone when they
 * do not, readings alone when the item has no usable profile, and null when neither
 * exists. Keys in the readings' `absent` are deleted: the person said the work did not
 * carry them as they experienced it. feel_prior is no longer read (§4.2); committed item
 * profiles replace it.
 */
export function entryVectorFamily(e: EntryWithContext, family: Family): AttributeVector | null {
  if (e.entry.status === "want") return null;

  // v2 rows store { story, feeling } in the same jsonb vector column the flat v1 map uses.
  const familyVector = (x: EntryWithContext["extractions"][number]): AttributeVector | null => {
    const v = x.vector as unknown as { story?: AttributeVector; feeling?: AttributeVector } | null;
    const out = v && typeof v === "object" && !Array.isArray(v) ? v[family] ?? null : null;
    if (!out || typeof out !== "object" || Array.isArray(out) || Object.keys(out).length === 0) return null;
    try { assertNonNegative(out, `stored ${family} reading`); } catch { return null; }
    return Object.values(out).every((value) => Number.isFinite(value) && value <= 1) ? out : null;
  };
  const absentKeys = (x: EntryWithContext["extractions"][number]): string[] => {
    const r = x.attributes as unknown as { absent?: string[] } | null;
    return Array.isArray(r?.absent) ? r.absent : [];
  };

  const readings = e.extractions
    .filter((x) => x.status === "done" && x.vocabulary_version === VOCABULARY_V2_VERSION && familyVector(x) !== null)
    .sort((x, y) => (y.extracted_at ?? "").localeCompare(x.extracted_at ?? ""));

  const profileVector = usableProfile(e.item)?.vector[family] ?? null;
  const p = profileVector && Object.keys(profileVector).length > 0 ? profileVector : null;
  let v: AttributeVector | null;
  if (readings.length === 0) {
    v = p;
  } else {
    const r = blend(readings.map((x, i) => ({ v: familyVector(x)!, w: i === 0 ? 1 : 0.5 })));
    v = p ? blend([{ v: r, w: 0.8 }, { v: p, w: 0.2 }]) : r;
  }
  if (!v) return null;

  for (const x of readings) for (const k of absentKeys(x)) delete v[k];
  return v;
}

/**
 * ownWords (§4.3): the person put their own words on this entry — a done v2 reading whose
 * reaction carries a note. Drives the "what I valued" phrase in explanations.
 */
export function hasOwnWordsV2(e: EntryWithContext): boolean {
  const noted = new Set(e.reactions.filter((r) => (r.raw_note ?? "").trim().length > 0).map((r) => r.id));
  return e.extractions.some((x) => x.status === "done" && x.vocabulary_version === VOCABULARY_V2_VERSION && noted.has(x.reaction_id));
}

/** False for onboarding and canon entries the user has not dated. Eras and phases skip those. */
export function isDated(e: EntryWithContext): boolean {
  return entrySpan(e.entry) !== null;
}
