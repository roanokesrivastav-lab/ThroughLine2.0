import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { canonDeck } from "@/lib/catalog/canon";

/** The rapid canon pass. Ordered by encounter likelihood only; nothing here implies quality. */
export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  const { data: profile } = await supabase.from("users").select("onboarding_prefs").eq("id", user.id).maybeSingle();
  const prefs = (profile?.onboarding_prefs as { canon?: Record<string, string> } | null) ?? {};
  const { data: entries } = await supabase.from("entries").select("media_items(source, external_id)").eq("user_id", user.id);
  const exclude = new Set<string>(Object.keys(prefs.canon ?? {}));
  for (const e of entries ?? []) {
    const mi = (e as unknown as { media_items: { source: string; external_id: string } | null }).media_items;
    if (mi?.source === "canon") exclude.add(mi.external_id);
  }
  let seed = 0;
  for (const ch of user.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return NextResponse.json({ cards: canonDeck(exclude, 25, seed || 7) });
});
