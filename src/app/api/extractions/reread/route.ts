import { NextResponse, after } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { aiProvider } from "@/lib/ai/extractor";
import { runPendingExtractions } from "@/lib/server/extraction";
import { syncPhases } from "@/lib/server/phases";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";

/**
 * Re-read the user's notes with the extractor that is configured now.
 * A new vocabulary gets a new row so historical readings remain correctly versioned.
 * Pressing twice costs nothing when the current version/provider row is already done.
 */
export const POST = route(async () => {
  const { user, supabase } = await requireUser();
  const current = aiProvider();

  const [reactions, currentRows] = await Promise.all([
    supabase.from("reactions").select("id,entry_id").eq("user_id", user.id),
    supabase.from("extracted_attributes").select("id,reaction_id,extractor,status")
      .eq("user_id", user.id).eq("vocabulary_version", VOCABULARY_VERSION),
  ]);
  if (reactions.error) throw new HttpError(500, reactions.error.message);
  if (currentRows.error) throw new HttpError(500, currentRows.error.message);

  const byReaction = new Map((currentRows.data ?? []).map((row) => [row.reaction_id, row]));
  const resetIds: string[] = [];
  const missing = [];
  for (const reaction of reactions.data ?? []) {
    const row = byReaction.get(reaction.id);
    if (!row) {
      missing.push({
        reaction_id: reaction.id, entry_id: reaction.entry_id, user_id: user.id,
        status: "pending" as const, vocabulary_version: VOCABULARY_VERSION,
      });
    } else if (row.extractor !== current || row.status !== "done") {
      resetIds.push(row.id);
    }
  }

  if (resetIds.length) {
    const { error } = await supabase.from("extracted_attributes")
      .update({ status: "pending", attempts: 0, last_error: null })
      .in("id", resetIds);
    if (error) throw new HttpError(500, error.message);
  }
  if (missing.length) {
    const { error } = await supabase.from("extracted_attributes")
      .upsert(missing, { onConflict: "reaction_id,vocabulary_version", ignoreDuplicates: true });
    if (error) throw new HttpError(500, error.message);
  }

  // Home recommendations are cached for a day; they were built from the old readings.
  await supabase.from("query_sessions").delete().eq("user_id", user.id).eq("kind", "home");

  after(async () => {
    try {
      // Sequential and slow on purpose (one model call per note); runs after the response.
      for (let i = 0; i < 20; i++) {
        const { processed, failed } = await runPendingExtractions(supabase, { userId: user.id, limit: 10 });
        if (processed + failed === 0) break;
      }
      await syncPhases(supabase, user.id);
    } catch (err) { console.error("[reread] failed:", err); }
  });

  return NextResponse.json({ queued: resetIds.length + missing.length, provider: current, vocabulary_version: VOCABULARY_VERSION });
});
