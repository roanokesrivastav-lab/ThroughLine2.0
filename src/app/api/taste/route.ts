import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { loadLibrary } from "@/lib/server/entries";
import { loadPhases } from "@/lib/server/phases";
import { buildEvolution } from "@/lib/taste/evolution";
import { buildPortrait } from "@/lib/taste/portrait";
import { serializeEntry } from "@/lib/server/dto";

export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  const [library, phases] = await Promise.all([loadLibrary(supabase, user.id), loadPhases(supabase, user.id)]);
  const evolution = buildEvolution(library, phases);
  const ids = new Set(evolution.periods.flatMap((p) => p.representative));
  return NextResponse.json({
    portrait: buildPortrait(library),
    evolution,
    entries: Object.fromEntries(library.filter((e) => ids.has(e.entry.id)).map((e) => [e.entry.id, serializeEntry(e)])),
    phases,
  });
});
