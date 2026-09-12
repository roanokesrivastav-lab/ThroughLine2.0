import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { loadLibrary } from "@/lib/server/entries";
import { findConnections } from "@/lib/taste/connections";
import { serializeEntry } from "@/lib/server/dto";

export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  const library = await loadLibrary(supabase, user.id);
  const connections = findConnections(library, { limit: 12, maxPerEntry: 3, minSimilarity: 0.4 }).map((c) => ({
    a: serializeEntry(c.a), b: serializeEntry(c.b), similarity: c.similarity, shared: c.shared, explanation: c.explanation,
  }));
  return NextResponse.json({ connections, withWords: library.filter((e) => e.extractions.some((x) => x.status === "done")).length, total: library.length });
});
