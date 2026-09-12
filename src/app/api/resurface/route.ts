import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { getOrCreateResurfaceCard } from "@/lib/server/resurface";
import { serializeEntry } from "@/lib/server/dto";
import { loadLibrary } from "@/lib/server/entries";

export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  const card = await getOrCreateResurfaceCard(supabase, user.id);
  const { data: history } = await supabase.from("resurface_events").select("*").eq("user_id", user.id).not("response", "is", null).order("responded_at", { ascending: false }).limit(20);
  const library = await loadLibrary(supabase, user.id);
  const byId = new Map(library.map((e) => [e.entry.id, e]));
  return NextResponse.json({
    card: card ? { eventId: card.event.id, entry: serializeEntry(card.entry) } : null,
    history: (history ?? []).flatMap((h) => { const e = byId.get(h.entry_id); return e ? [{ id: h.id, response: h.response, responded_at: h.responded_at, entry: serializeEntry(e) }] : []; }),
  });
});
