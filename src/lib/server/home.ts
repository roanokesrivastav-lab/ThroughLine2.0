import "server-only";
import { after } from "next/server";
import type { Db } from "./entries";
import { loadLibrary } from "./entries";
import { getOrCreateResurfaceCard } from "./resurface";
import { buildStageRecommendations, queueDeferredProfiles, readHomeCache, supabaseRecommendStore } from "./stage-recommend";
import { loadPhases } from "./phases";
import { loadTastePrefs } from "./recommend";
import { findConnections } from "@/lib/taste/connections";
import { buildPortrait } from "@/lib/taste/portrait";
import { serializeEntry, type EntryDTO } from "./dto";
import { adapterFor } from "@/lib/catalog";
import { getExplainer } from "@/lib/ai/explainer";
import type { Recommendation, WeightedTag } from "@/lib/types";

export type HomePayload = {
  portrait: ReturnType<typeof buildPortrait>;
  connections: Array<{ a: EntryDTO; b: EntryDTO; similarity: number; shared: WeightedTag[]; explanation: string }>;
  resurface: { eventId: string; entry: EntryDTO } | null;
  recommendations: Recommendation[];
  counts: { entries: number; withWords: number; pendingExtractions: number; phases: number };
};

export async function buildHome(db: Db, userId: string): Promise<HomePayload> {
  const library = await loadLibrary(db, userId);
  const portrait = buildPortrait(library);
  const connections = findConnections(library, { limit: 5 }).map((c) => ({
    a: serializeEntry(c.a), b: serializeEntry(c.b), similarity: c.similarity, shared: c.shared, explanation: c.explanation,
  }));
  const card = await getOrCreateResurfaceCard(db, userId, library);
  const phases = await loadPhases(db, userId);

  // Recommendations are the smallest section; reuse today's set unless the library changed.
  // readHomeCache returns null for legacy rows, so the first load after the switch-over
  // rebuilds once instead of sending old-shape data to the new card.
  let recommendations: Recommendation[] = [];
  const logged = library.filter((e) => e.entry.status !== "want").length;
  if (logged >= 3) {
    const { data: cached } = await db.from("query_sessions").select("answers").eq("user_id", userId).eq("kind", "home")
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).order("created_at", { ascending: false }).limit(1);
    if (cached?.[0]?.answers) {
      // "Not for me" keys live in the user's prefs blob; a fresh cache row may predate a
      // dismissal (review P2), so hidden rows are filtered out here too — otherwise the
      // just-hidden card reappears from the cache on the next visit.
      const { hidden } = await loadTastePrefs(db, userId);
      const hiddenKeys = new Set(hidden);
      const fromCache = readHomeCache(cached[0].answers, library.length, hiddenKeys);
      if (fromCache) recommendations = fromCache;
    }
    if (recommendations.length === 0) {
      const { recommendations: built, deferred } = await buildStageRecommendations(
        supabaseRecommendStore(db),
        { adapterFor, now: () => new Date(), explain: (s) => getExplainer().explain(s) },
        userId,
        { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 3 },
        { kind: "home", cache: { entryCount: library.length } },
      );
      recommendations = built;
      // The insert already wrote the day cache into answers.full; nothing else to store.
      after(() => queueDeferredProfiles(deferred));
    }
  }

  return {
    portrait,
    connections,
    resurface: card ? { eventId: card.event.id, entry: serializeEntry(card.entry) } : null,
    recommendations,
    counts: {
      entries: logged,
      withWords: library.filter((e) => e.reactions.some((r) => (r.raw_note ?? "").trim())).length,
      pendingExtractions: library.reduce((n, e) => n + e.extractions.filter((x) => x.status !== "done").length, 0),
      phases: phases.filter((p) => !p.dismissed).length,
    },
  };
}
