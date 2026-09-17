import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { canonDeck } from "@/lib/catalog/canon";
import { CANON } from "@/lib/catalog/canon-data";

const titleKey = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");

/** The rapid canon pass. Ordered by encounter likelihood only; nothing here implies quality. */
export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  const { data: profile } = await supabase.from("users").select("onboarding_prefs").eq("id", user.id).maybeSingle();
  const prefs = (profile?.onboarding_prefs as { canon?: Record<string, string> } | null) ?? {};
  const { data: entries } = await supabase.from("entries").select("media_items(source, external_id, title, category)").eq("user_id", user.id);
  const exclude = new Set<string>(Object.keys(prefs.canon ?? {}));
  const owned = new Set<string>();
  for (const e of entries ?? []) {
    const mi = (e as unknown as { media_items: { source: string; external_id: string; title: string; category: string } | null }).media_items;
    if (!mi) continue;
    if (mi.source === "canon") exclude.add(mi.external_id);
    // Also skip a card the user already added from a live catalogue (Parasite from TMDB, say).
    owned.add(`${mi.category}:${titleKey(mi.title)}`);
  }
  for (const c of CANON) if (owned.has(`${c.category}:${titleKey(c.title)}`)) exclude.add(c.slug);
  let seed = 0;
  for (const ch of user.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return NextResponse.json({ cards: canonDeck(exclude, 25, seed || 7) });
});
