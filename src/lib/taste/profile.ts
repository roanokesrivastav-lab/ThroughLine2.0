// The Stage 3 user taste profile (SPEC-STAGE3 §4, §1.5): pure, deterministic, and
// computed from the library plus the loaded phases — never stored, except as the
// snapshot context the engine session will build. Everything here reads affinity()
// (§4.1, unchanged), entryVectorFamily() (§4.2) and blend(); no scoring happens in
// this file.

import type { AttributeVector, Category, EntryWithContext, Phase } from "@/lib/types";
import { LOVED, MAX_ANCHORS, PHASE_ACTIVE_DAYS, ANTI_MIN_EVIDENCE } from "./weights";
import { usableProfile, entryVectorFamily, hasOwnWordsV2, affinity } from "./affinity";
import { blend, type Family } from "./vector";
import { familyOf } from "./vocabulary";
import { buildTagProfile, EMPTY_TASTE_PREFS, type CreatorAffinity, type TastePrefs } from "./tags";

/** A family profile, or null when the user has no loved profiled entry (§1.5): the component is 0 for every candidate. */
export type FamilyProfile = { centroid: AttributeVector; anchors: Anchor[] } | null;

export type Anchor = {
  entryId: string;
  itemId: string;
  category: Category;
  vector: AttributeVector;
  affinity: number;
  ownWords: boolean;
};

/** The one active phase (§1.6, §4.7); null means no phase is active. */
export type ActivePhase = {
  id: string;
  kind: "feeling_cluster" | "genre_run" | "category_stretch";
  label: string;
  end_at: string;
  confidence: number;
  /** feeling_cluster: the dominant vocabulary key; genre_run: the normalised genre; category_stretch: the category. */
  key: string;
  /** feeling_cluster only. */
  second: string | null;
};

export type UserProfile = {
  story: FamilyProfile;
  feeling: FamilyProfile;
  /** dist sums to 1; n = loved entries with a known band in that category; the category is absent when n < 3. */
  form: Partial<Record<Category, { dist: [number, number, number, number]; n: number }>>;
  creators: Map<string, CreatorAffinity>;
  activePhase: ActivePhase | null;
  /** A family is null while its distinct evidence IDs are < ANTI_MIN_EVIDENCE (§4.6); evidence = distinct (entryId, source) pairs across both families, counted once globally. */
  anti: { story: AttributeVector | null; feeling: AttributeVector | null; evidence: number };
  evidence: { loved: number; notes: number; profiled: number };
};

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * buildUserProfile (§4.3–§4.7). Deterministic: the same library, phases and prefs give
 * the same profile. `now` is optional (defaults to the real clock) so tests can pin it;
 * it only affects phase eligibility.
 */
export function buildUserProfile(
  library: EntryWithContext[],
  phases: Phase[],
  prefs: TastePrefs = EMPTY_TASTE_PREFS,
  now: Date = new Date(),
): UserProfile {
  const logged = library.filter((e) => e.entry.status !== "want");
  const aff = new Map<string, number>();
  for (const e of logged) aff.set(e.entry.id, affinity(e));

  // §4.3: loved entries per family, with the family vector computed once.
  const vec = new Map<string, AttributeVector | null>();
  const familyVec = (e: EntryWithContext, f: Family): AttributeVector | null => {
    const k = `${f}:${e.entry.id}`;
    if (!vec.has(k)) vec.set(k, entryVectorFamily(e, f));
    return vec.get(k)!;
  };

  const familyProfile = (f: Family): FamilyProfile => {
    const loved = logged
      .filter((e) => aff.get(e.entry.id)! >= LOVED && familyVec(e, f) !== null)
      .sort((a, b) => aff.get(b.entry.id)! - aff.get(a.entry.id)! || b.entry.created_at.localeCompare(a.entry.created_at) || a.entry.id.localeCompare(b.entry.id));
    if (loved.length === 0) return null;
    // Centroid weights are aff²: how often a person returns to something is the taste.
    const centroid = blend(loved.map((e) => ({ v: familyVec(e, f) as AttributeVector, w: aff.get(e.entry.id)! ** 2 })));
    const anchors: Anchor[] = loved.slice(0, MAX_ANCHORS).map((e) => ({
      entryId: e.entry.id,
      itemId: e.item.id,
      category: e.item.category,
      vector: familyVec(e, f)!,
      affinity: aff.get(e.entry.id)!,
      ownWords: hasOwnWordsV2(e),
    }));
    return { centroid, anchors };
  };

  // §4.4: form distribution per category over loved entries with a known band.
  const form: UserProfile["form"] = {};
  const bandSum = new Map<Category, { sum: [number, number, number, number]; n: number }>();
  for (const e of logged) {
    if (aff.get(e.entry.id)! < LOVED) continue;
    const band = usableProfile(e.item)?.form.band ?? null;
    if (band == null) continue;
    const slot = bandSum.get(e.item.category) ?? { sum: [0, 0, 0, 0], n: 0 };
    slot.sum[band] += aff.get(e.entry.id)!;
    slot.n += 1;
    bandSum.set(e.item.category, slot);
  }
  for (const [c, { sum, n }] of bandSum) {
    if (n < 3) continue; // the category is omitted below three loved entries
    const total = sum[0] + sum[1] + sum[2] + sum[3];
    if (total <= 0) continue;
    form[c] = { dist: sum.map((s) => s / total) as [number, number, number, number], n };
  }

  // §4.7: the one active phase.
  const activePhase = pickActivePhase(phases, now);

  // §4.6: the anti-profile. Evidence pieces, each routed to the families it has a vector
  // for. A family becomes non-null only at ANTI_MIN_EVIDENCE distinct evidence IDs *of
  // that family*: one note naming two disliked keys is one piece of evidence, not two.
  const parts: Record<Family, Array<{ v: AttributeVector; w: number }>> = { story: [], feeling: [] };
  const familyEvidence: Record<Family, Set<string>> = { story: new Set(), feeling: new Set() };
  const globalEvidence = new Set<string>();
  const addEvidence = (f: Family, id: string) => {
    familyEvidence[f].add(id);
    globalEvidence.add(id);
  };
  const addPiece = (e: EntryWithContext, source: string, weight: number) => {
    for (const f of ["story", "feeling"] as Family[]) {
      const v = familyVec(e, f);
      if (v) {
        parts[f].push({ v, w: weight });
        addEvidence(f, `${e.entry.id}:${source}`);
      }
    }
  };

  for (const e of logged) {
    const a = aff.get(e.entry.id)!;
    // A dropped entry with a usable profile counts against at 1 − aff.
    if (e.entry.status === "dropped" && usableProfile(e.item)) addPiece(e, "dropped", 1 - a);
    // A "doesn't hit" resurface counts at 0.5. One piece per (entry, source): repeated
    // responses are one signal, not several (the evidence counter is per distinct pair).
    if (e.resurfaces.some((r) => r.response === "doesnt_hit") && usableProfile(e.item)) addPiece(e, "doesnt_hit", 0.5);
    // Every valid didnt_work key in a v2 reading, one-hot, at the entry's affinity with a
    // 0.5 floor. All keys from one entry are collectively one evidence ID per affected
    // family: a note with two dislikes is one piece of evidence, not two. Keys must pass
    // exact vocabulary validation (familyOf) or they neither route nor count.
    for (const x of e.extractions) {
      if (x.status !== "done" || x.vocabulary_version !== "v2") continue;
      const r = x.attributes as unknown as { didnt_work?: { keys?: Array<{ key: string; weight: number }> } } | null;
      for (const t of r?.didnt_work?.keys ?? []) {
        const f = familyOf(t.key);
        if (f === null) continue; // malformed or unknown key: never routes, never counts
        parts[f].push({ v: { [t.key]: t.weight }, w: Math.max(a, 0.5) });
        addEvidence(f, `${e.entry.id}:didnt_work`);
      }
    }
  }
  const antiVector = (f: Family): AttributeVector | null =>
    familyEvidence[f].size >= ANTI_MIN_EVIDENCE ? blend(parts[f]) : null;

  return {
    story: familyProfile("story"),
    feeling: familyProfile("feeling"),
    form,
    creators: buildTagProfile(library, prefs).creators,
    activePhase,
    anti: {
      story: antiVector("story"),
      feeling: antiVector("feeling"),
      evidence: globalEvidence.size,
    },
    evidence: {
      loved: logged.filter((e) => aff.get(e.entry.id)! >= LOVED).length,
      notes: logged.filter((e) => e.reactions.some((r) => (r.raw_note ?? "").trim().length > 0)).length,
      profiled: logged.filter((e) => usableProfile(e.item) !== null).length,
    },
  };
}

/**
 * Active-phase selection (§4.7): eligible phases are undismissed, one of the three
 * matching kinds, and end_at ≥ today − 90 days; the pick is max by confidence, then
 * latest end_at, then fingerprint ascending. creator_run and album are excluded.
 * A phase whose evidence lacks the field its kind needs is skipped — it cannot name a key.
 */
export function pickActivePhase(phases: Phase[], now: Date = new Date()): ActivePhase | null {
  const cutoff = isoDate(new Date(now.getTime() - PHASE_ACTIVE_DAYS * DAY));
  const eligible = phases.filter((p) => {
    if (p.dismissed) return false;
    if (p.kind !== "feeling_cluster" && p.kind !== "genre_run" && p.kind !== "category_stretch") return false;
    return p.end_at >= cutoff;
  });
  if (eligible.length === 0) return null;

  const keyFor = (p: Phase): { key: string; second: string | null } | null => {
    const ev = p.evidence as Record<string, unknown>;
    if (p.kind === "feeling_cluster") {
      // v2 mapping: theme keys stay "theme.x"; the scalar "ache" stays "ache" (§4.7).
      const dominant = typeof ev.dominant === "string" && familyOf(ev.dominant) !== null ? ev.dominant : null;
      if (!dominant) return null;
      const second = typeof ev.second === "string" && familyOf(ev.second) !== null ? ev.second : null;
      return { key: dominant, second };
    }
    if (p.kind === "genre_run") {
      return typeof ev.genre === "string" && ev.genre ? { key: ev.genre, second: null } : null;
    }
    return typeof ev.category === "string" && ev.category ? { key: ev.category, second: null } : null;
  };

  const usable = eligible
    .map((p) => ({ p, ks: keyFor(p) }))
    .filter((x): x is { p: Phase; ks: { key: string; second: string | null } } => x.ks !== null);
  if (usable.length === 0) return null;

  usable.sort((a, b) =>
    b.p.confidence - a.p.confidence ||
    b.p.end_at.localeCompare(a.p.end_at) ||
    a.p.fingerprint.localeCompare(b.p.fingerprint),
  );
  const { p, ks } = usable[0];
  return {
    id: p.id,
    kind: p.kind as ActivePhase["kind"],
    label: p.user_label ?? p.label,
    end_at: p.end_at,
    confidence: p.confidence,
    key: ks.key,
    second: ks.second,
  };
}

/** Re-exported so the engine session has one import surface for the whole profile layer. */
export { usableProfile, entryVectorFamily, hasOwnWordsV2, affinity as entryAffinity };
/** All five media get profiled (DECISIONS #50); only the four below are matched in Stage 3 (§E Q1, #61). */
export const PROFILED_CATEGORIES = ["movie", "tv", "anime", "book", "music"] as const satisfies readonly Category[];
export const MATCHED_CATEGORIES = ["movie", "tv", "anime", "book"] as const satisfies readonly Category[];
export type { EntryWithContext };
