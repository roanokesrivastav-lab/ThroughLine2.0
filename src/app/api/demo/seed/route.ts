import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/server/auth";
import { seedDemo } from "@/lib/server/demo";

export const POST = route(async () => {
  const { user, supabase } = await requireUser();
  const result = await seedDemo(supabase, user.id);
  return NextResponse.json(result);
});
