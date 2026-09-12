import { NextResponse } from "next/server";
import { z } from "zod";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { notificationPrefsSchema } from "@/lib/server/schemas";
import { loadProfile } from "@/lib/server/profile";
import type { Database } from "@/lib/db/types";

export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  return NextResponse.json(await loadProfile(supabase, user.id, user.email));
});

const patchSchema = z.object({
  notificationPrefs: notificationPrefsSchema.optional(),
  onboardingPrefs: z.record(z.string(), z.unknown()).optional(),
  onboardingCompleted: z.boolean().optional(),
});

export const PATCH = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const body = patchSchema.parse(await req.json());
  const current = await loadProfile(supabase, user.id, user.email);
  const update: Database["public"]["Tables"]["users"]["Update"] = {};
  if (body.notificationPrefs) update.notification_prefs = { ...current.notificationPrefs, ...body.notificationPrefs } as Database["public"]["Tables"]["users"]["Row"]["notification_prefs"];
  if (body.onboardingPrefs) update.onboarding_prefs = { ...current.onboardingPrefs, ...body.onboardingPrefs } as Database["public"]["Tables"]["users"]["Row"]["onboarding_prefs"];
  if (body.onboardingCompleted !== undefined) update.onboarding_completed_at = body.onboardingCompleted ? new Date().toISOString() : null;
  const { error } = await supabase.from("users").update(update).eq("id", user.id);
  if (error) throw new HttpError(500, error.message);
  return NextResponse.json(await loadProfile(supabase, user.id, user.email));
});
