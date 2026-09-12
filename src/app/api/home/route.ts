import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { buildHome } from "@/lib/server/home";

export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  return NextResponse.json(await buildHome(supabase, user.id));
});
