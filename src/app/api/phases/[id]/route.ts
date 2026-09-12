import { NextResponse } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { phaseUpdateSchema } from "@/lib/server/schemas";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user, supabase } = await requireUser();
  const { id } = await params;
  const body = phaseUpdateSchema.parse(await req.json());
  const { data, error } = await supabase.from("phases").update(body).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) throw new HttpError(500, error.message);
  return NextResponse.json({ phase: data });
});
