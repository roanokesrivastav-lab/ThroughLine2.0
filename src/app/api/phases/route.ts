import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { loadPhases, syncPhases } from "@/lib/server/phases";

export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  return NextResponse.json({ phases: await loadPhases(supabase, user.id) });
});

export const POST = route(async () => {
  const { user, supabase } = await requireUser();
  const result = await syncPhases(supabase, user.id);
  return NextResponse.json({ ...result, phases: await loadPhases(supabase, user.id) });
});
