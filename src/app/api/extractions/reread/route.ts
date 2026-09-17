import { NextResponse, after } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { aiProvider } from "@/lib/ai/extractor";
import { runPendingExtractions } from "@/lib/server/extraction";
import { syncPhases } from "@/lib/server/phases";

/**
 * Re-read the user's notes with the extractor that is configured now.
 * Only readings made by a different extractor are redone, so pressing it twice costs nothing.
 * Raw notes are never touched; only extracted_attributes rows are reset to pending.
 */
export const POST = route(async () => {
  const { user, supabase } = await requireUser();
  const current = aiProvider();
  if (current === "mock") throw new HttpError(400, "No AI provider is configured, so there is nothing better to re-read with.");

  const { data, error } = await supabase.from("extracted_attributes")
    .update({ status: "pending", attempts: 0, last_error: null })
    .eq("user_id", user.id)
    .or(`extractor.is.null,extractor.neq.${current},status.neq.done`)
    .select("id");
  if (error) throw new HttpError(500, error.message);

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

  return NextResponse.json({ queued: data?.length ?? 0, provider: current });
});
