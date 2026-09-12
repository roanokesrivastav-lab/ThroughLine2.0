import { NextResponse } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { hideRecommendationSchema } from "@/lib/server/schemas";
import { loadTastePrefs } from "@/lib/server/recommend";
import type { Database } from "@/lib/db/types";

/** Cap so the prefs blob stays small; oldest dismissals fall off first. */
const MAX_HIDDEN = 400;

/**
 * "Not for me" on a single recommendation. Item-scoped by design: it removes
 * this one thing and never widens into a judgement about its creator or its
 * kind. Stored in the user's prefs rather than a table, which keeps the whole
 * baseline migration-free.
 */
export const POST = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const body = hideRecommendationSchema.parse(await req.json());

  const { data: row } = await supabase.from("users").select("onboarding_prefs").eq("id", user.id).maybeSingle();
  const prefs = (row?.onboarding_prefs as Record<string, unknown> | null) ?? {};
  const taste = await loadTastePrefs(supabase, user.id);

  const hidden = body.undo
    ? taste.hidden.filter((k) => k !== body.candidate_key)
    : [...taste.hidden.filter((k) => k !== body.candidate_key), body.candidate_key].slice(-MAX_HIDDEN);

  const { error } = await supabase
    .from("users")
    .update({ onboarding_prefs: { ...prefs, taste: { ...taste, hidden } } as Database["public"]["Tables"]["users"]["Row"]["onboarding_prefs"] })
    .eq("id", user.id);
  if (error) throw new HttpError(500, error.message);

  return NextResponse.json({ ok: true, hidden: hidden.length });
});
