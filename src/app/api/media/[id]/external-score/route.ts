import { NextResponse } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { adapterBySource } from "@/lib/catalog";

/** Only reached when the user explicitly taps "reveal". Never called on render. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { supabase } = await requireUser();
  const { id } = await params;
  const { data: item } = await supabase.from("media_items").select("source, external_id, category").eq("id", id).maybeSingle();
  if (!item) throw new HttpError(404, "Not found");
  const adapter = adapterBySource(item.source);
  if (!adapter?.externalScore || !adapter.available()) return NextResponse.json({ score: null, reason: "No external source for this item." });
  try {
    const score = await adapter.externalScore(item.external_id, item.category);
    return NextResponse.json({ score });
  } catch {
    return NextResponse.json({ score: null, reason: "Could not reach the source." });
  }
});
