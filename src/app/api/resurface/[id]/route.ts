import { NextResponse, after } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { resurfaceRespondSchema } from "@/lib/server/schemas";
import { queueExtraction, runPendingExtractions } from "@/lib/server/extraction";
import { getOrCreateResurfaceCard } from "@/lib/server/resurface";
import { serializeEntry } from "@/lib/server/dto";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user, supabase } = await requireUser();
  const { id } = await params;
  const body = resurfaceRespondSchema.parse(await req.json());
  const { data: event, error } = await supabase.from("resurface_events").select("*").eq("id", id).eq("user_id", user.id).single();
  if (error || !event) throw new HttpError(404, "Not found");

  let noteReactionId: string | null = null;
  if (body.note?.trim()) {
    const dims = body.response === "still_hits" ? { stuck_with_me: true } : {};
    const { data: reaction } = await supabase.from("reactions").insert({ entry_id: event.entry_id, user_id: user.id, dimensions: dims, raw_note: body.note.trim(), source: "resurface" }).select("*").single();
    if (reaction) { noteReactionId = reaction.id; await queueExtraction(supabase, { reactionId: reaction.id, entryId: event.entry_id, userId: user.id }); }
  }
  const snoozedUntil = body.response === "snoozed" ? new Date(Date.now() + (body.snooze_days ?? 30) * 86_400_000).toISOString() : null;
  await supabase.from("resurface_events").update({ response: body.response, responded_at: new Date().toISOString(), note_reaction_id: noteReactionId, snoozed_until: snoozedUntil }).eq("id", id);
  if (noteReactionId) after(() => runPendingExtractions(supabase, { userId: user.id, limit: 3 }).catch(console.error));

  const next = body.response === "snoozed" ? null : await getOrCreateResurfaceCard(supabase, user.id);
  return NextResponse.json({ ok: true, next: next ? { eventId: next.event.id, entry: serializeEntry(next.entry) } : null });
});
