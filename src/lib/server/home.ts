import "server-only";
import type { Db } from "./entries";
import { loadLibrary } from "./entries";
import { getOrCreateResurfaceCard } from "./resurface";
import { buildRecommendations } from "./recommend";
import { loadPhases } from "./phases";
import { findConnections } from "@/lib/taste/connections";
import { buildPortrait } from "@/lib/taste/portrait";
import { serializeEntry, type EntryDTO } from "./dto";
import type { Recommendation, WeightedTag } from "@/lib/types";
import type { QuerySessionsRow } from "@/lib/db/types";

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
  let recommendations: Recommendation[] = [];
  const logged = library.filter((e) => e.entry.status !== "want").length;
  if (logged >= 3) {
    const { data: cached } = await db.from("query_sessions").select("*").eq("user_id", userId).eq("kind", "home")
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).order("created_at", { ascending: false }).limit(1);
    const prev = cached?.[0];
    const answers = prev?.answers as { entryCount?: number; full?: Recommendation[] } | null;
    if (prev && answers?.entryCount === library.length && answers.full?.length) recommendations = answers.full;
    else {
      recommendations = await buildRecommendations(db, userId, { limit: 3 }, { library, kind: "home" });
      // Stash the full explained set alongside so tomorrow is free.
      await db.from("query_sessions").update({ answers: { entryCount: library.length, full: recommendations } as unknown as QuerySessionsRow["answers"] })
        .eq("user_id", userId).eq("kind", "home").order("created_at", { ascending: false }).limit(1);
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
