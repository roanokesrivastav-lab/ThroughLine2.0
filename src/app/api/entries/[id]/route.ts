import { NextResponse, after } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { updateEntrySchema } from "@/lib/server/schemas";
import { loadEntry, loadLibrary } from "@/lib/server/entries";
import { serializeEntry } from "@/lib/server/dto";
import { syncPhases } from "@/lib/server/phases";
import { findConnections } from "@/lib/taste/connections";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { user, supabase } = await requireUser();
  const { id } = await params;
  const library = await loadLibrary(supabase, user.id);
  const e = library.find((x) => x.entry.id === id);
  if (!e) throw new HttpError(404, "Not found");
  const connections = findConnections(library, { limit: 4, focusEntryId: id, minSimilarity: 0.38, maxPerEntry: 4 }).map((c) => ({
    other: serializeEntry(c.a.entry.id === id ? c.b : c.a), similarity: c.similarity, shared: c.shared, explanation: c.explanation,
  }));
  const { data: phases } = await supabase.from("phase_members").select("phases(*)").eq("entry_id", id);
  return NextResponse.json({ entry: serializeEntry(e), connections, phases: (phases ?? []).map((p) => (p as unknown as { phases: unknown }).phases).filter(Boolean) });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { user, supabase } = await requireUser();
  const { id } = await params;
  const body = updateEntrySchema.parse(await req.json());
  const { error } = await supabase.from("entries").update(body).eq("id", id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  after(() => syncPhases(supabase, user.id).catch(console.error));
  const e = await loadEntry(supabase, user.id, id);
  return NextResponse.json({ entry: e ? serializeEntry(e) : null });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { user, supabase } = await requireUser();
  const { id } = await params;
  const { error } = await supabase.from("entries").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  after(() => syncPhases(supabase, user.id).catch(console.error));
  return NextResponse.json({ ok: true });
});
