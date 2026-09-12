import { NextResponse, after } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { reactionSchema } from "@/lib/server/schemas";
import { queueExtraction, runPendingExtractions } from "@/lib/server/extraction";
import { syncPhases } from "@/lib/server/phases";
import { loadEntry } from "@/lib/server/entries";
import { serializeEntry } from "@/lib/server/dto";
import type { ReactionsRow } from "@/lib/db/types";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user, supabase } = await requireUser();
  const { id } = await params;
  const body = reactionSchema.parse(await req.json());
  const { data: reaction, error } = await supabase.from("reactions").insert({
    entry_id: id, user_id: user.id, dimensions: (body.dimensions ?? {}) as ReactionsRow["dimensions"], raw_note: body.note?.trim() || null, source: body.source,
  }).select("*").single();
  if (error || !reaction) throw new HttpError(500, error?.message ?? "Could not save reaction");
  await queueExtraction(supabase, { reactionId: reaction.id, entryId: id, userId: user.id });
  after(async () => {
    await runPendingExtractions(supabase, { userId: user.id, limit: 5 }).catch(console.error);
    await syncPhases(supabase, user.id).catch(console.error);
  });
  const e = await loadEntry(supabase, user.id, id);
  return NextResponse.json({ entry: e ? serializeEntry(e) : null }, { status: 201 });
});
