import { NextResponse, after } from "next/server";
import { z } from "zod";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { createEntrySchema } from "@/lib/server/schemas";
import { enrichMediaItem, loadLibrary, upsertMediaItem } from "@/lib/server/entries";
import { queueExtraction, runPendingExtractions } from "@/lib/server/extraction";
import { profileItemsNow } from "@/lib/server/profiles";
import { syncPhases } from "@/lib/server/phases";
import { serializeEntry } from "@/lib/server/dto";
import { CATEGORIES, ENTRY_STATUSES } from "@/lib/types";
import type { ReactionsRow } from "@/lib/db/types";
import { entryDate, isDated } from "@/lib/taste/affinity";
import { dayWhen, todayIso } from "@/lib/taste/when";
import type { CatalogResult } from "@/lib/catalog/types";
import type { Db } from "@/lib/server/entries";

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);

/**
 * Something the catalogues could not find, typed in by the user. Keyed to that user so one
 * person's hand-typed title never merges with, or shows up for, anyone else. No image and no
 * feeling prior: nothing is claimed about it beyond what they typed.
 */
function manualResult(r: CatalogResult, userId: string): CatalogResult {
  return {
    ...r, source: "manual", external_id: `${userId}:${r.category}:${slug(r.title) || "untitled"}`,
    image_url: null, feel_prior: null, genre_tags: [],
    creators: r.subtitle ? [{ name: r.subtitle, role: r.category === "book" ? "author" : r.category === "music" ? "artist" : r.category === "movie" ? "director" : "creator" }] : [],
    metadata: r.category === "book" && r.metadata.book_kind ? { book_kind: r.metadata.book_kind } : {},
  };
}

/** True when every tapped dimension is already on one of the entry's reactions. */
async function tapsAlreadyRecorded(db: Db, entryId: string, dims: Record<string, boolean | undefined>): Promise<boolean> {
  const tapped = Object.entries(dims).filter(([, v]) => v).map(([k]) => k);
  if (!tapped.length) return false;
  const { data } = await db.from("reactions").select("dimensions").eq("entry_id", entryId);
  const seen = new Set((data ?? []).flatMap((r) => Object.entries((r.dimensions ?? {}) as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k)));
  return tapped.every((k) => seen.has(k));
}

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
  // Date filters are about when something was consumed, so undated entries cannot match them.
  if (f.year || f.from || f.to) library = library.filter(isDated);
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
  let pendingEnrich: { itemId: string; result: CatalogResult } | null = null;
  if (!mediaItemId && body.result) {
    const result = body.result.source === "manual" ? manualResult(body.result, user.id) : body.result;
    const item = await upsertMediaItem(result);
    mediaItemId = item.id;
    if (result.source !== "manual") pendingEnrich = { itemId: item.id, result };
  }
  if (!mediaItemId) throw new HttpError(400, "No media item");
  const itemId = mediaItemId;

  // Profile on log (founder, 2026-09-23): after metadata enrichment, in one after(),
  // bounded by PROFILE_INLINE_LIMIT. Manual items are profiled from title, creators and
  // book kind only. Canon items resolve from the committed profile file with no model
  // call, and an existing media_item_id is profiled too — the store only picks rows that
  // still need a profile. A save never waits on, or fails because of, profiling.
  after(async () => {
    try {
      if (pendingEnrich) await enrichMediaItem(pendingEnrich.itemId, pendingEnrich.result);
      await profileItemsNow([itemId]);
    } catch (err) {
      console.error("[entries] post-save enrich/profile failed:", err);
    }
  });

  // Say nothing about when unless the user did, or this is an ordinary "just finished" log.
  // Onboarding picks stay undated rather than being stamped with today (migration 0002).
  const when = body.consumed_at !== undefined
    ? { consumed_at: body.consumed_at, consumed_until: body.consumed_at ? (body.consumed_until ?? null) : null, consumed_precision: body.consumed_at ? (body.consumed_precision ?? "day") : null }
    : body.origin === "log" && body.status === "completed" ? dayWhen(todayIso()) : {};

  const { data: existing } = await supabase.from("entries").select("id").eq("user_id", user.id).eq("media_item_id", mediaItemId).maybeSingle();
  const { data: entry, error } = await supabase.from("entries").upsert(
    { user_id: user.id, media_item_id: mediaItemId, status: body.status, private_score: body.private_score ?? null, origin: body.origin, ...(existing && body.consumed_at === undefined ? {} : when) },
    { onConflict: "user_id,media_item_id" },
  ).select("*").single();
  if (error || !entry) throw new HttpError(500, error?.message ?? "Could not save");

  const hasReaction = (body.note && body.note.trim()) || (body.dimensions && Object.values(body.dimensions).some(Boolean));
  if (hasReaction && !body.note?.trim() && existing && await tapsAlreadyRecorded(supabase, entry.id, body.dimensions ?? {})) {
    // Picking the same thing twice (e.g. after going back in onboarding) should not double its weight.
  } else if (hasReaction) {
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
