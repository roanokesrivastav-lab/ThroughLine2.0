import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EntriesRow, ExtractedAttributesRow, MediaItemsRow, ReactionsRow, ResurfaceEventsRow } from "@/lib/db/types";
import { asDimensions, asExtractionPayload, asItemProfile, asStoredVector, asVector } from "@/lib/db/types";
import type { Creator, Entry, EntryWithContext, MediaItem, MediaMetadata } from "@/lib/types";
import type { CatalogResult } from "@/lib/catalog/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PROFILE_VERSION } from "@/lib/taste/weights";

export type Db = SupabaseClient<Database>;

export function rowToItem(r: MediaItemsRow): MediaItem {
  return {
    id: r.id, category: r.category, title: r.title, subtitle: r.subtitle, source: r.source, external_id: r.external_id,
    image_url: r.image_url, release_year: r.release_year,
    creators: Array.isArray(r.creators) ? (r.creators as unknown as Creator[]) : [],
    genre_tags: r.genre_tags ?? [],
    metadata: (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as MediaMetadata,
    feel_prior: asVector(r.feel_prior),
    profile: r.profile_status === "done" && r.profile_version === PROFILE_VERSION ? asItemProfile(r.profile) : null,
  };
}
export function rowToEntry(r: EntriesRow): Entry {
  return { id: r.id, user_id: r.user_id, media_item_id: r.media_item_id, status: r.status, private_score: r.private_score, consumed_at: r.consumed_at, consumed_until: r.consumed_until, consumed_precision: r.consumed_precision, origin: r.origin, created_at: r.created_at, updated_at: r.updated_at };
}
export function rowToReaction(r: ReactionsRow) {
  return { id: r.id, entry_id: r.entry_id, user_id: r.user_id, dimensions: asDimensions(r.dimensions), raw_note: r.raw_note, source: r.source, created_at: r.created_at };
}
export function rowToExtraction(r: ExtractedAttributesRow) {
  return { id: r.id, reaction_id: r.reaction_id, entry_id: r.entry_id, user_id: r.user_id, status: r.status, attributes: asExtractionPayload(r.attributes, r.vocabulary_version), vector: asStoredVector(r.vector, r.vocabulary_version), vocabulary_version: r.vocabulary_version, extractor: r.extractor, attempts: r.attempts, last_error: r.last_error, extracted_at: r.extracted_at, created_at: r.created_at };
}
export function rowToResurface(r: ResurfaceEventsRow) {
  return { id: r.id, user_id: r.user_id, entry_id: r.entry_id, surfaced_at: r.surfaced_at, channel: r.channel, response: r.response, responded_at: r.responded_at, note_reaction_id: r.note_reaction_id, snoozed_until: r.snoozed_until };
}

/** Everything the engines need about a user's library, in one round of queries. */
export async function loadLibrary(db: Db, userId: string): Promise<EntryWithContext[]> {
  const [entries, reactions, extractions, resurfaces] = await Promise.all([
    db.from("entries").select("*, media_items(*)").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("reactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("extracted_attributes").select("*").eq("user_id", userId),
    db.from("resurface_events").select("*").eq("user_id", userId).order("surfaced_at", { ascending: false }),
  ]);
  for (const r of [entries, reactions, extractions, resurfaces]) if (r.error) throw new Error(r.error.message);

  const byEntry = <T extends { entry_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.entry_id, [...(m.get(r.entry_id) ?? []), r]);
    return m;
  };
  const rx = byEntry(reactions.data ?? []), ex = byEntry(extractions.data ?? []), rs = byEntry(resurfaces.data ?? []);

  const rows = (entries.data ?? []) as unknown as Array<EntriesRow & { media_items: MediaItemsRow | null }>;
  return rows.flatMap((row) => {
    const item = row.media_items;
    if (!item) return [];
    return [{
      entry: rowToEntry(row),
      item: rowToItem(item),
      reactions: (rx.get(row.id) ?? []).map(rowToReaction),
      extractions: (ex.get(row.id) ?? []).map(rowToExtraction),
      resurfaces: (rs.get(row.id) ?? []).map(rowToResurface),
    }];
  });
}

export async function loadEntry(db: Db, userId: string, entryId: string): Promise<EntryWithContext | null> {
  const all = await loadLibrary(db, userId);
  return all.find((e) => e.entry.id === entryId) ?? null;
}

/** Upsert a catalog result into the shared media table (service role: the catalog is shared, not user-owned). */
export async function upsertMediaItem(result: CatalogResult): Promise<MediaItem> {
  const admin = supabaseAdmin();
  const row = {
    category: result.category, title: result.title, subtitle: result.subtitle, source: result.source, external_id: result.external_id,
    image_url: result.image_url, release_year: result.release_year,
    creators: result.creators as unknown as MediaItemsRow["creators"], genre_tags: result.genre_tags,
    metadata: result.metadata as unknown as MediaItemsRow["metadata"],
    feel_prior: (result.feel_prior ?? null) as MediaItemsRow["feel_prior"],
  };
  const { data, error } = await admin.from("media_items").upsert(row, { onConflict: "source,external_id" }).select("*").single();
  if (error) throw new Error(error.message);
  return rowToItem(data);
}

/** Best-effort metadata enrichment after save (runtime, creators). Never blocks the user. */
export async function enrichMediaItem(itemId: string, result: CatalogResult) {
  const { adapterBySource } = await import("@/lib/catalog");
  const adapter = adapterBySource(result.source);
  if (!adapter?.enrich) return;
  try {
    const full = await adapter.enrich(result);
    await supabaseAdmin().from("media_items").update({
      subtitle: full.subtitle ?? result.subtitle, creators: full.creators as unknown as MediaItemsRow["creators"],
      metadata: full.metadata as unknown as MediaItemsRow["metadata"],
    }).eq("id", itemId);
  } catch (err) {
    console.warn("[enrich] skipped:", (err as Error).message);
  }
}
