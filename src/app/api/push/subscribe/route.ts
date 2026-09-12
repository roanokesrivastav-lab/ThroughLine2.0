import { NextResponse } from "next/server";
import { z } from "zod";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { pushSubscriptionSchema } from "@/lib/server/schemas";

export const POST = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const body = pushSubscriptionSchema.parse(await req.json());
  const { error } = await supabase.from("push_subscriptions").upsert({ user_id: user.id, endpoint: body.endpoint, keys: body.keys, user_agent: body.user_agent ?? null }, { onConflict: "endpoint" });
  if (error) throw new HttpError(500, error.message);
  await supabase.from("users").update({ notification_prefs: { push: true, cadence: "weekly", snoozed_until: null } }).eq("id", user.id).is("notification_prefs->>push", null);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await req.json());
  await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
});
