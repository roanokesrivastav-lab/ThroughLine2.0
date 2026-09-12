import type { AttributeVector, Category, EntryWithContext, MediaItem, Recommendation, Route, ScoreAdjustment, ScoreComponent, TagMatch, WeightedTag } from "@/lib/types";
import { affinity, bestQuote, entryVector, latestExtraction } from "./affinity";
import { tasteCentroid } from "./portrait";
import { isEmpty, similarity } from "./vector";
import { sharedPhrase } from "./connections";
import { listTags } from "./tag-lexicon";
import {
  buildTagProfile,
  candidateKey,
  creatorMatch,
  isMuted,
  tagOverlap,
  type CreatorAffinity,
  type TagProfile,
  type TastePrefs,
} from "./tags";

export type TimeBudget = 20 | 40 | 60 | 150 | null;

export type RecommendFilters = {
  category?: Category | null;
  minutes?: TimeBudget;          // hard filter on runtime / episode length / song length; books use reading session heuristics
  listOnly?: boolean;            // only the user's own backlog
  returnable?: boolean;          // "something I can return to repeatedly"
  shortRead?: boolean;           // "something short to read"
  surprise?: boolean;            // random-ish pick from backlog, still explained
  limit?: number;
};

export type Candidate = {
  item: MediaItem;
  entryId?: string;              // present for backlog items
  vector: AttributeVector | null;
  creatorOf?: string[];          // entry ids of loved entries by the same creator (structural bridge)
};

/**
 * Which signal actually produced this pick. Derived from whichever component
 * contributed most, so the explanation can never claim a reason the arithmetic
 * did not support.
 */
export const ROUTES = ["tag_overlap", "creator", "feeling", "backlog"] as const satisfies readonly Route[];
export type { Route } from "@/lib/types";

export const ROUTE_LABEL: Record<Route, string> = {
  tag_overlap: "Kinds of thing you go for",
  creator: "Same hands",
  feeling: "Connection in feeling",
  backlog: "From your list",
};

export type { ScoreComponent, ScoreAdjustment } from "@/lib/types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Estimated minutes to finish (or to make a satisfying dent in) this item. */
export function estimatedMinutes(item: MediaItem): number | null {
  const m = item.metadata;
  switch (item.category) {
    case "movie": return m.runtime_minutes ?? null;
    case "tv":
    case "anime": return m.episode_runtime_minutes ?? null;
    case "music": return m.duration_seconds ? Math.max(1, Math.round(m.duration_seconds / 60)) : 4;
    case "book": return m.pages ? Math.round(m.pages * 1.6) : null; // ~1.6 min/page, used only for "short read"
  }
}

export function fitsTime(item: MediaItem, minutes: TimeBudget): { ok: boolean; note: string | null } {
  if (!minutes) return { ok: true, note: null };
  const est = estimatedMinutes(item);
  if (item.category === "book") {
    // A reading session is flexible; only very short budgets exclude books.
    if (minutes < 40) return { ok: false, note: null };
    return { ok: true, note: est && est <= 240 ? "Short enough to finish in a few sittings" : "A chapter or two" };
  }
  if (item.category === "tv" || item.category === "anime") {
    if (est == null) return { ok: minutes >= 40, note: "One episode" };
    return est <= minutes ? { ok: true, note: `One episode, about ${est} min` } : { ok: false, note: null };
  }
  if (est == null) return { ok: minutes >= 150, note: null };
  return est <= minutes ? { ok: true, note: `${est} min` } : { ok: false, note: null };
}

/** Deterministic hash for "surprise me": stable within a day so refreshes do not thrash. */
function daySeed(userSalt: string): number {
  const s = `${userSalt}:${new Date().toISOString().slice(0, 10)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/**
 * How much of the score the feeling layer is allowed to carry.
 *
 * The emotional attributes are extracted from notes, so with no notes they are
 * guesswork and the tag layer should lead. Each note written shifts the balance,
 * and by a dozen the feeling layer leads instead. This is what makes the tag
 * engine a genuine baseline rather than a dead end: nothing has to be rewritten
 * when the richer attribute work lands, because the seam is already here.
 */
export function feelingWeight(notes: number): number {
  return clamp(0.15 + 0.65 * (notes / 12), 0.15, 0.8);
}

const COMPONENT_LABEL: Record<string, string> = {
  tag_overlap: "Kinds of thing you go for",
  creator: "Someone you go back to",
  feeling: "Close to the centre of your taste",
  anchor: "Close to one thing you loved",
};

/**
 * Structured filters → deterministic scoring → explanations added afterwards.
 * Nothing here looks at popularity, external ratings, or other users.
 */
export function scoreCandidates(
  history: EntryWithContext[],
  candidates: Candidate[],
  filters: RecommendFilters,
  userSalt = "x",
  profile?: TagProfile,
  prefs?: TastePrefs,
): Recommendation[] {
  const limit = filters.limit ?? 5;
  const tags = profile ?? buildTagProfile(history, prefs);
  const anchors = history
    .map((e) => ({ e, v: entryVector(e), aff: affinity(e) }))
    .filter((a): a is { e: EntryWithContext; v: AttributeVector; aff: number } => !!a.v && a.aff >= 0.55)
    .sort((a, b) => b.aff - a.aff)
    .slice(0, 40);
  const centroid = tasteCentroid(history);
  const inLibrary = new Set(history.map((h) => h.item.id));

  const feelW = feelingWeight(tags.evidence.notes);
  const ruleW = 1 - feelW;
  const WEIGHTS = {
    tag_overlap: ruleW * 0.72,
    creator: ruleW * 0.28,
    feeling: feelW * 0.55,
    anchor: feelW * 0.45,
  };

  const scored: Recommendation[] = [];
  for (const c of candidates) {
    // ---- Hard filters. A rejected candidate never gets a score at all. ----
    if (filters.category && c.item.category !== filters.category) continue;
    if (filters.listOnly && !c.entryId) continue;
    if (!c.entryId && inLibrary.has(c.item.id)) continue;
    if (filters.shortRead && c.item.category !== "book") continue;
    if (tags.hidden.has(candidateKey(c.item))) continue;
    if (isMuted(c.item.genre_tags, tags)) continue;
    const fit = fitsTime(c.item, filters.minutes ?? null);
    if (!fit.ok) continue;
    if (filters.shortRead) {
      const est = estimatedMinutes(c.item);
      if (est != null && est > 480) continue; // > ~300 pages is not a short read
    }

    // ---- Rule layer: tags and creators, available from the first tap. ----
    const overlap = tagOverlap(c.item.genre_tags, tags);
    const creator: CreatorAffinity | null = creatorMatch(c.item, tags);
    const creatorValue = creator?.weight ?? (c.creatorOf?.length ? 0.35 : 0);

    // ---- Feeling layer: only where there is something to compare. ----
    const v = c.vector && !isEmpty(c.vector) ? c.vector : null;
    let best: { a: (typeof anchors)[number]; sim: ReturnType<typeof similarity> } | null = null;
    if (v) {
      for (const a of anchors) {
        if (a.e.item.id === c.item.id) continue;
        const sim = similarity(v, a.v);
        if (!best || sim.score * (0.6 + a.aff * 0.4) > best.sim.score * (0.6 + best.a.aff * 0.4)) best = { a, sim };
      }
    }
    const feelingValue = v && centroid ? similarity(v, centroid).score : null;
    const anchorValue = best ? best.sim.score : null;

    const components: ScoreComponent[] = [
      mk("tag_overlap", WEIGHTS.tag_overlap, overlap.score),
      mk("creator", WEIGHTS.creator, creatorValue),
      mk("feeling", WEIGHTS.feeling, feelingValue),
      mk("anchor", WEIGHTS.anchor, anchorValue),
    ];

    // Re-normalise over the components that actually have evidence. Without
    // this, anything the feeling layer cannot read — most live catalogue
    // results — would be structurally capped below the hand-written canon.
    const live = components.filter((k) => k.value !== null);
    const liveWeight = live.reduce((n, k) => n + k.weight, 0);
    if (liveWeight <= 0) continue;
    let total = live.reduce((n, k) => n + k.contribution, 0) / liveWeight;

    // ---- Additive adjustments, applied after normalisation so caps are literal. ----
    const adjustments: ScoreAdjustment[] = [];
    if (filters.returnable) {
      const comfort = v ? (v["aftertaste.comforting"] ?? 0) * 0.15 + (v["tone.warm"] ?? 0) * 0.1 : 0;
      if (comfort > 0) adjustments.push({ key: "reaction_bonus", label: "Something to return to", delta: comfort });
    }
    const anchorScore = best?.a.e.entry.private_score;
    const hint = anchorScore != null ? ((anchorScore - 5.5) / 10) * 0.05 : 0;
    if (hint !== 0) adjustments.push({ key: "score_hint", label: "Your private score", delta: hint });
    for (const adj of adjustments) total += adj.delta;

    if (filters.surprise && c.entryId) total = total * 0.5 + daySeed(userSalt + c.item.id) * 0.5;

    const route = routeOf(components, c, filters);
    const shared: WeightedTag[] = best?.sim.shared ?? [];
    scored.push({
      item: c.item,
      entryId: c.entryId,
      score: total,
      route,
      breakdown: {
        components,
        adjustments,
        normalisedWeight: liveWeight,
        total,
        matchedTags: overlap.matched.slice(0, 5),
        tagCoverage: overlap.coverage,
        creator: creator ? { name: creator.name, role: creator.role, entryIds: creator.entryIds } : null,
        // Legacy mirror, so callers written against the first engine keep working.
        attribute_similarity: feelingValue ?? 0,
        bridge_similarity: anchorValue ?? 0,
        reaction_bonus: adjustments.find((a) => a.key === "reaction_bonus")?.delta ?? 0,
        score_hint: hint,
        creator_bridge: creatorValue,
      },
      bridge: best ? {
        entryId: best.a.e.entry.id, title: best.a.e.item.title, category: best.a.e.item.category,
        summary: latestExtraction(best.a.e)?.summary ?? null, quote: bestQuote(best.a.e), shared,
      } : null,
      explanation: "",
      fits: fit.note,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  // ---- Diversity is a selection pass, never a score mutation, so the number
  // shown in the breakdown is always the number that was computed. ----
  const perBridge = new Map<string, number>();
  const perCat = new Map<string, number>();
  const perCreator = new Map<string, number>();
  const out: Recommendation[] = [];
  for (const r of scored) {
    const b = r.bridge?.entryId ?? "none";
    const maker = r.breakdown.creator?.name.toLowerCase() ?? r.item.subtitle?.toLowerCase() ?? "none";
    if ((perBridge.get(b) ?? 0) >= 2) continue;
    if (maker !== "none" && (perCreator.get(maker) ?? 0) >= 2) continue;
    if (!filters.category && (perCat.get(r.item.category) ?? 0) >= 2 && out.length < limit - 1) continue;
    perBridge.set(b, (perBridge.get(b) ?? 0) + 1);
    perCreator.set(maker, (perCreator.get(maker) ?? 0) + 1);
    perCat.set(r.item.category, (perCat.get(r.item.category) ?? 0) + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  // Fall back to plain order if diversity constraints starved the list below three.
  if (out.length < Math.min(3, scored.length)) return scored.slice(0, limit).map(withFallbackExplanation);
  return out.map(withFallbackExplanation);
}

function mk(key: string, weight: number, value: number | null): ScoreComponent {
  return { key, label: COMPONENT_LABEL[key] ?? key, weight, value, contribution: value === null ? 0 : weight * value };
}

/** The route is whichever component carried the pick, not a label chosen by hand. */
function routeOf(components: ScoreComponent[], c: Candidate, filters: RecommendFilters): Route {
  if (c.entryId && (filters.listOnly || filters.surprise)) return "backlog";
  const top = [...components].filter((k) => k.contribution > 0).sort((a, b) => b.contribution - a.contribution)[0];
  switch (top?.key) {
    case "creator": return "creator";
    case "feeling":
    case "anchor": return "feeling";
    case "tag_overlap": return "tag_overlap";
    default: return c.entryId ? "backlog" : "tag_overlap";
  }
}

/**
 * The deterministic explanation. Also the base the AI explainer improves on, so
 * both paths tell the same story and neither can invent a reason.
 */
export function fallbackExplanation(r: Recommendation): string {
  const b = r.breakdown;
  const matched = b.matchedTags.slice(0, 2).map((m: TagMatch) => m.tag);

  switch (r.route) {
    case "creator": {
      const name = b.creator?.name ?? r.item.subtitle;
      const also = matched.length ? ` It is also ${listTags(matched)}, which you go for.` : "";
      return `Same hands as something you loved: ${name}.${also}`;
    }
    case "feeling":
      return feelingSentence(r);
    case "backlog": {
      const feel = r.bridge ? ` ${feelingSentence(r)}` : "";
      const time = r.fits ? ` ${r.fits}.` : "";
      return `From your own list.${time}${feel}`.trim();
    }
    case "tag_overlap":
    default: {
      if (matched.length === 0) return feelingSentence(r);
      const lead = `You keep coming back to ${listTags(matched)}.`;
      const rest = matched.length > 1 ? " This is both." : " This is too.";
      const creator = b.creator ? ` It is by ${b.creator.name}, who you have loved before.` : "";
      return `${lead}${rest}${creator}`;
    }
  }
}

/** The original connection-in-feeling wording, unchanged, for picks the feeling layer drove. */
function feelingSentence(r: Recommendation): string {
  if (!r.bridge) return "It sits close to the centre of what you tend to love.";
  const phrase = sharedPhrase(r.bridge.shared);
  const what = r.bridge.summary ? `the ${r.bridge.summary} in ${r.bridge.title}` : r.bridge.title;
  const quote = r.bridge.quote ? ` You wrote “${r.bridge.quote}”${/[.!?…]$/.test(r.bridge.quote) ? "" : "."}` : "";
  const cross = r.bridge.category !== r.item.category
    ? "This connects to something you loved in another medium: "
    : "This connects to something you loved: ";
  return `${cross}${what}.${quote} The same ${phrase} is here.`;
}

function withFallbackExplanation(r: Recommendation): Recommendation {
  return { ...r, explanation: r.explanation || fallbackExplanation(r) };
}
