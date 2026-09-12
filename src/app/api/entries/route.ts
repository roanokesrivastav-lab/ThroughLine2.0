import { NextResponse, after } from "next/server";
import { z } from "zod";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { createEntrySchema } from "@/lib/server/schemas";
import { enrichMediaItem, loadLibrary, upsertMediaItem } from "@/lib/server/entries";
import { queueExtraction, runPendingExtractions } from "@/lib/server/extraction";
import { syncPhases } from "@/lib/server/phases";
import { serializeEntry } from "@/lib/server/dto";
import { CATEGORIES, ENTRY_STATUSES } from "@/lib/types";
import type { ReactionsRow } from "@/lib/db/types";
import { entryDate } from "@/lib/taste/affinity";

const listSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  year: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const url = new URL(req.url);
  const f = listSchema.parse(Object.fromEntries([...url.searchParams.entries()].filter(([, v]) => v !== "")));
  let library = await loadLibrary(supabase, user.id);
  if (f.category) library = library.filter((e) => e.item.category === f.category);
  if (f.status) library = library.filter((e) => e.entry.status === f.status);
  if (f.year) library = library.filter((e) => entryDate(e).getUTCFullYear() === f.year);
  if (f.from) library = library.filter((e) => entryDate(e).toISOString().slice(0, 10) >= f.from!);
  if (f.to) library = library.filter((e) => entryDate(e).toISOString().slice(0, 10) <= f.to!);
  library.sort((a, b) => entryDate(b).getTime() - entryDate(a).getTime());
  return NextResponse.json({ entries: library.map(serializeEntry) });
});

export const POST = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const body = createEntrySchema.parse(await req.json());

  let mediaItemId = body.media_item_id;
  if (!mediaItemId && body.result) {
    const item = await upsertMediaItem(body.result);
    mediaItemId = item.id;
    const result = body.result;
    after(() => enrichMediaItem(item.id, result));
  }
  if (!mediaItemId) throw new HttpError(400, "No media item");

  const { data: entry, error } = await supabase.from("entries").upsert(
    { user_id: user.id, media_item_id: mediaItemId, status: body.status, private_score: body.private_score ?? null, consumed_at: body.consumed_at ?? (body.status === "completed" ? new Date().toISOString().slice(0, 10) : null), origin: body.origin },
    { onConflict: "user_id,media_item_id" },
  ).select("*").single();
  if (error || !entry) throw new HttpError(500, error?.message ?? "Could not save");

  const hasReaction = (body.note && body.note.trim()) || (body.dimensions && Object.values(body.dimensions).some(Boolean));
  if (hasReaction) {
    const { data: reaction, error: rErr } = await supabase.from("reactions").insert({
      entry_id: entry.id, user_id: user.id, dimensions: (body.dimensions ?? {}) as ReactionsRow["dimensions"], raw_note: body.note?.trim() || null, source: body.origin === "log" ? "log" : "onboarding",
    }).select("*").single();
    if (rErr) console.error("[entries] reaction failed:", rErr.message);
    if (reaction) await queueExtraction(supabase, { reactionId: reaction.id, entryId: entry.id, userId: user.id });
  }

  // Never block the save on AI. Extraction and phase detection run after the response is sent.
  after(async () => {
    try {
      await runPendingExtractions(supabase, { userId: user.id, limit: 10 });
      await syncPhases(supabase, user.id);
    } catch (err) { console.error("[entries] post-save work failed:", err); }
  });

  const library = await loadLibrary(supabase, user.id);
  const dto = library.find((e) => e.entry.id === entry.id);
  return NextResponse.json({ entry: dto ? serializeEntry(dto) : null }, { status: 201 });
});
