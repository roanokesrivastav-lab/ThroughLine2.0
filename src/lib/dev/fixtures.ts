// Builds a full in-memory library from the demo seeds, running the mock extractor,
// so the engines can be exercised (tests, previews) without a database.
import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { mockExtract } from "@/lib/ai/mock-extractor";
import { SEEDS } from "@/lib/server/demo-seeds";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { familyOf } from "@/lib/taste/vocabulary";
import { band as formBand, minutesToFinish } from "@/lib/taste/form";
import type { AttributeVector, EntryWithContext, ItemProfile, MediaItem } from "@/lib/types";

const iso = (daysAgo: number, now: number) => new Date(now - daysAgo * 86_400_000).toISOString();

/**
 * PLACEHOLDER item profile for fixtures and tests (SPEC-STAGE3 §B26 says fixture items
 * carry profiles so tests run without a model; the real canon profiles are a generated
 * file from the real profiler, a later session). This derivation is deterministic and
 * does not pretend to be profiling: it routes the canon item's existing v1 feel_prior
 * keys to their v2 family with familyOf() and computes the length band with form.ts.
 * Attribute[] stay empty — the vector is the only thing a scorer reads, and these keys
 * are real vocabulary, but nothing here claims a model wrote a premise or craft list.
 */
export function fixtureProfile(item: MediaItem): ItemProfile {
  const story: AttributeVector = {};
  const feeling: AttributeVector = {};
  for (const [k, w] of Object.entries(item.feel_prior ?? {})) {
    const f = familyOf(k);
    if (f === "story") story[k] = Math.max(0, Math.min(1, w));
    else if (f === "feeling") feeling[k] = Math.max(0, Math.min(1, w));
  }
  const minutes = minutesToFinish(item);
  return {
    profile_version: PROFILE_VERSION,
    vocabulary_version: "v2",
    premise: null, // placeholder: the profiler writes this; none is invented here
    story: [],
    feeling: [],
    form: { minutes_to_finish: minutes, band: formBand(item.category, minutes), craft: [] },
    vector: { story, feeling },
  };
}

/**
 * profiles: "placeholder" (default) derives the feel_prior-routed placeholder as before, so
 * every existing test is unaffected. "canon" attaches the committed NVIDIA-written profile
 * for the slug (canonProfile) and falls back to the placeholder for the one unprofiled slug.
 */
export function buildFixtureLibrary(now = Date.now(), opts: { profiles?: "placeholder" | "canon" } = {}): EntryWithContext[] {
  const seen = new Set<string>();
  const out: EntryWithContext[] = [];
  for (const s of SEEDS) {
    if (seen.has(s.slug)) continue;
    seen.add(s.slug);
    const canon = CANON_BY_SLUG.get(s.slug);
    if (!canon) continue;
    const r = canonToResult(canon);
    const profile = opts.profiles === "canon" ? canonProfile(s.slug) ?? fixtureProfile(r as MediaItem) : fixtureProfile(r as MediaItem);
    const item: MediaItem = { ...r, id: `item-${s.slug}`, feel_prior: r.feel_prior ?? null, profile };
    const entryId = `entry-${s.slug}`;
    const created = iso(s.daysAgo, now);
    const e: EntryWithContext = {
      entry: { id: entryId, user_id: "u", media_item_id: item.id, status: s.status ?? "completed", private_score: s.score ?? null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day", origin: "demo", created_at: created, updated_at: created },
      item, reactions: [], extractions: [], resurfaces: [],
    };
    if (s.note || (s.dims && Object.keys(s.dims).length)) {
      const reactionId = `reaction-${s.slug}`;
      e.reactions.push({ id: reactionId, entry_id: entryId, user_id: "u", dimensions: s.dims ?? {}, raw_note: s.note ?? null, source: "demo", created_at: created });
      const x = mockExtract({ note: s.note ?? null, dimensions: s.dims ?? {}, category: item.category, title: item.title, subtitle: item.subtitle });
      e.extractions.push({ id: `x-${s.slug}`, reaction_id: reactionId, entry_id: entryId, user_id: "u", status: "done", attributes: x.extraction, vector: x.vector, vocabulary_version: x.vocabulary_version, extractor: "mock", attempts: 1, last_error: null, extracted_at: created, created_at: created });
    }
    if (s.resurface) {
      const when = iso(Math.max(1, s.daysAgo - 120), now);
      e.resurfaces.push({ id: `rs-${s.slug}`, user_id: "u", entry_id: entryId, surfaced_at: when, channel: "home", response: s.resurface, responded_at: when, note_reaction_id: null, snoozed_until: null });
    }
    out.push(e);
  }
  return out;
}
