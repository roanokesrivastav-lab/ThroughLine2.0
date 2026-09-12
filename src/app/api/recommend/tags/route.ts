import { NextResponse } from "next/server";
import { route, requireUser, HttpError } from "@/lib/server/auth";
import { tastePrefsSchema } from "@/lib/server/schemas";
import { loadLibrary } from "@/lib/server/entries";
import { loadTastePrefs } from "@/lib/server/recommend";
import { availableTags, buildTagProfile } from "@/lib/taste/tags";
import { tagSpecificity } from "@/lib/taste/tag-lexicon";
import type { Database } from "@/lib/db/types";

/**
 * The vocabulary the Settings picker offers: tags drawn from the user's own
 * history with the weights the engine actually derived, not an abstract
 * taxonomy handed to them to fill in.
 */
export const GET = route(async () => {
  const { user, supabase } = await requireUser();
  const [library, prefs] = await Promise.all([loadLibrary(supabase, user.id), loadTastePrefs(supabase, user.id)]);
  const profile = buildTagProfile(library, prefs);
  return NextResponse.json({
    prefs,
    tags: availableTags(profile, 40).map((t) => ({
      tag: t.tag,
      weight: t.weight,
      pinned: t.pinned,
      count: t.entryIds.length,
      categories: t.categories,
      specificity: tagSpecificity(t.tag),
    })),
    evidence: profile.evidence,
  });
});

export const PATCH = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const body = tastePrefsSchema.parse(await req.json());

  const { data: row } = await supabase.from("users").select("onboarding_prefs").eq("id", user.id).maybeSingle();
  const prefsBlob = (row?.onboarding_prefs as Record<string, unknown> | null) ?? {};
  const current = await loadTastePrefs(supabase, user.id);
  // Merge field by field so a picker that only knows about tags cannot wipe the
  // dismissed list, and vice versa.
  const taste = {
    pinned: body.pinned ?? current.pinned,
    muted: body.muted ?? current.muted,
    hidden: body.hidden ?? current.hidden,
  };

  const { error } = await supabase
    .from("users")
    .update({ onboarding_prefs: { ...prefsBlob, taste } as Database["public"]["Tables"]["users"]["Row"]["onboarding_prefs"] })
    .eq("id", user.id);
  if (error) throw new HttpError(500, error.message);

  return NextResponse.json({ prefs: taste });
});
