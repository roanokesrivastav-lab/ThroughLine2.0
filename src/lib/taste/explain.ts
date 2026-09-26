// The deterministic explanation layer (SPEC-STAGE3 §8). Everything reads only the
// snapshot, so any stored sentence can be rebuilt byte-identically from its stored
// fields (§C37). The legacy wording in recommend.ts is ported, not imported, except
// the sharedPhrase shape. Forbidden evidence (§8.6) never enters a sentence.
import type { Category, WeightedTag } from "@/lib/types";
import type { Anchor, EntryWithContext } from "./profile";
import type { ScoredCandidate, AnchorPick } from "./score";
import { sharedForFamily } from "./score";
import type { ImpressionSnapshot, RouteV3, Filters } from "./snapshot";
import { describeKey } from "./vocabulary";
import { latestExtractionV2 } from "./affinity";

const TIE = 1e-9;
const NON_ANTI: Array<{ key: keyof ScoredCandidate["contributions"]; route: Exclude<RouteV3, "backlog" | "anti"> }> = [
  { key: "story", route: "story" },
  { key: "feeling", route: "feeling" },
  { key: "creator", route: "creator" },
  { key: "phase", route: "phase" },
  { key: "form", route: "form" },
];

/** The route (§8.1): backlog when forced and the item is logged, else the argmax contribution; anti is never a route. */
export function routeOf(s: ScoredCandidate, filters: Filters): RouteV3 {
  if ((filters.listOnly || filters.surprise) && s.candidate.entryId) return "backlog";
  let best = NON_ANTI[0];
  for (const entry of NON_ANTI) {
    if (s.contributions[entry.key] > s.contributions[best.key] + TIE) best = entry;
  }
  if (s.contributions[best.key] <= 0) return s.candidate.entryId ? "backlog" : "story";
  return best.route;
}

/** The anchor (§8.2): the route family's pick, else the higher calibrated similarity, story on ties. */
export function anchorOf(s: ScoredCandidate, route: RouteV3): AnchorPick | null {
  if (route === "story") return s.anchors.story;
  if (route === "feeling") return s.anchors.feeling;
  const { story, feeling } = s.anchors;
  if (!story) return feeling;
  if (!feeling) return story;
  return feeling.sim > story.sim + TIE ? feeling : story; // story first on ties
}

/** Shared attributes for the route family (§8.3): ending dropped, first 3. */
export function sharedFor(s: ScoredCandidate, route: RouteV3, anchor: AnchorPick | null): WeightedTag[] {
  if (!anchor) return [];
  const family = route === "story" || route === "feeling" ? route : anchor.family;
  const vec = s.candidate.item.profile?.vector[family] ?? {};
  return sharedForFamily(family, vec, anchor.anchor.vector);
}

/** The §9.1 explain block: only these fields may ever reach a sentence (§8.4). */
export function explainFields(args: {
  route: RouteV3;
  anchor: AnchorPick | null;
  anchorEntry: EntryWithContext | null;
  item: { category: Category; creators: Array<{ name: string }> };
}): ImpressionSnapshot["explain"] {
  const { route, anchor, anchorEntry, item } = args;
  // The creator name rides on the item, not the anchor: a creator route with no
  // anchor yet still names its creator (review round). Summary/quote/valued are
  // anchor-entry fields and need the entry; the newest **v2** reading supplies them.
  const x = anchorEntry ? latestExtractionV2(anchorEntry) : null;
  const valued =
    anchor && anchorEntry && (route === "story" || route === "feeling") && anchor.anchor.ownWords
      ? x?.valued?.[0] ?? null
      : null;
  return {
    summary: x?.summary ?? null,
    quote: x?.quote ?? null,
    valued,
    creator: route === "creator" ? item.creators[0]?.name ?? null : null,
    phase_label: null, // filled by buildSnapshot from the active phase
    fits: null,        // filled by buildSnapshot from the caller's fits note
  };
}

// ---------------------------------------------------------------------------
// The deterministic sentence (§8.5). Reads only the snapshot.
// ---------------------------------------------------------------------------

const period = (sentence: string) => (/[.!?…]$/.test(sentence) ? sentence : `${sentence}.`);

/** The legacy shared-phrase: "x and y", degraded to one or a bare noun. */
function phrase(shared: ImpressionSnapshot["shared"]): string {
  const keys = shared.slice(0, 2).map((s) => describeKey(s.key));
  if (keys.length === 0) return "feeling";
  if (keys.length === 1) return keys[0];
  return `${keys[0]} and ${keys[1]}`;
}

/** The feeling sentence, ported from the legacy feelingSentence and driven by snapshot fields. */
function feelingSentence(snap: ImpressionSnapshot): string {
  const anchor = snap.anchor;
  if (!anchor) return "It sits close to the centre of what you tend to love.";
  const what = snap.explain.summary ? `the ${snap.explain.summary} in ${anchor.title}` : anchor.title;
  // The quote keeps the legacy conditional period; period() alone closes the lead sentence.
  const quote = snap.explain.quote ? ` You wrote “${snap.explain.quote}”${/[.!?…]$/.test(snap.explain.quote) ? "" : "."}` : "";
  const cross = snap.indicators.is_cross_media ? "This connects to something you loved in another medium: " : "This connects to something you loved: ";
  return `${cross}${period(what)}${quote} The same ${phrase(snap.shared)} is here.`;
}

/** The story sentence (§8.5 story), with the cross-media prefix and valued/quote fallbacks. */
function storySentence(snap: ImpressionSnapshot): string {
  const anchor = snap.anchor;
  if (!anchor) return "It sits close to the centre of what you tend to love.";
  const lead = snap.indicators.is_cross_media ? "This connects to something you loved in another medium: " : "This connects to ";
  const keys = snap.shared.map((s) => describeKey(s.key));
  const sharedPart = keys.length >= 2 ? `the same ${keys[0]} and ${keys[1]}` : keys.length === 1 ? `the same ${keys[0]}` : "";
  // One sentence, one terminal period — period() alone closes it (review round).
  const tail = period(`${lead}${anchor.title}${sharedPart ? `: ${sharedPart}` : ""}`);
  if (snap.explain.valued) return `${tail} What I valued: “${snap.explain.valued}”.`;
  if (snap.explain.quote) return `${tail} You wrote “${snap.explain.quote}”${/[.!?…]$/.test(snap.explain.quote) ? "" : "."}`;
  return tail;
}

/** The deterministic sentence for one route (§8.5); the AI explainer improves on this base. */
export function explanationFromSnapshot(snap: ImpressionSnapshot): string {
  const { route, explain } = snap;
  switch (route) {
    case "story":
      return storySentence(snap);
    case "feeling":
      return feelingSentence(snap);
    case "creator": {
      const name = explain.creator ?? "";
      const also = snap.shared[0] ? ` It is also ${describeKey(snap.shared[0].key)}.` : "";
      return `Same hands as something you loved: ${name}.${also}`;
    }
    case "phase": {
      const label = explain.phase_label ?? "";
      const rest = snap.anchor ? ` ${snap.indicators.is_cross_media ? storySentence(snap) : feelingSentence(snap)}` : "";
      return `Fits ${label}.${rest}`.trim();
    }
    case "form": {
      const fits = explain.fits ? `${period(explain.fits)} ` : "";
      return `${fits}It sits close to what you tend to love.`;
    }
    case "backlog": {
      const time = explain.fits ? ` ${period(explain.fits)}` : "";
      const feel = snap.anchor ? ` ${feelingSentence(snap)}` : "";
      return `From your own list.${time}${feel}`.trim();
    }
  }
}

/** The anchor's own display data (§9.1 anchor), from the library passed in. */
export function anchorBlock(anchor: AnchorPick | null, library: EntryWithContext[]): ImpressionSnapshot["anchor"] {
  if (!anchor) return null;
  const a: Anchor = anchor.anchor;
  const entry = library.find((e) => e.entry.id === a.entryId);
  return {
    entryId: a.entryId,
    itemId: a.itemId,
    title: entry?.item.title ?? "",
    category: a.category,
    affinity: a.affinity,
    ownWords: a.ownWords,
    family: anchor.family,
  };
}
