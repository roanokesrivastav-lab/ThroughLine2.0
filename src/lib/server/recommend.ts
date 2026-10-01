import "server-only";
import type { Db } from "./entries";
import type { TastePrefs } from "@/lib/taste/tags";

/** Reads the optional pinned / muted / hidden lists out of the user's prefs blob. */
export async function loadTastePrefs(db: Db, userId: string): Promise<TastePrefs> {
  const { data } = await db.from("users").select("onboarding_prefs").eq("id", userId).maybeSingle();
  const prefs = (data?.onboarding_prefs as { taste?: Partial<TastePrefs> } | null) ?? {};
  const taste = prefs.taste ?? {};
  return {
    pinned: Array.isArray(taste.pinned) ? taste.pinned : [],
    muted: Array.isArray(taste.muted) ? taste.muted : [],
    hidden: Array.isArray(taste.hidden) ? taste.hidden : [],
  };
}
