import "server-only";
import type { Db } from "./entries";
import { loadLibrary, rowToResurface } from "./entries";
import { pickResurfaceCandidate } from "@/lib/taste/resurface";
import type { EntryWithContext, ResurfaceEvent } from "@/lib/types";

export type ResurfaceCard = { event: ResurfaceEvent; entry: EntryWithContext } | null;

/** The open card for the home screen: reuse a pending one, else pick a fresh candidate. */
export async function getOrCreateResurfaceCard(db: Db, userId: string, library?: EntryWithContext[]): Promise<ResurfaceCard> {
  const lib = library ?? (await loadLibrary(db, userId));
  const { data: pending } = await db.from("resurface_events").select("*").eq("user_id", userId).is("response", null)
    .gte("surfaced_at", new Date(Date.now() - 14 * 86_400_000).toISOString()).order("surfaced_at", { ascending: false }).limit(1);
  if (pending?.[0]) {
    const entry = lib.find((e) => e.entry.id === pending[0].entry_id);
    if (entry) return { event: rowToResurface(pending[0]), entry };
  }
  const candidate = pickResurfaceCandidate(lib);
  if (!candidate) return null;
  const { data, error } = await db.from("resurface_events").insert({ user_id: userId, entry_id: candidate.entry.id, channel: "home" }).select("*").single();
  if (error) throw new Error(error.message);
  const withEvent = { ...candidate, resurfaces: [rowToResurface(data), ...candidate.resurfaces] };
  return { event: rowToResurface(data), entry: withEvent };
}
