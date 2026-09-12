import type { AttributeVector, Category, EntryWithContext } from "@/lib/types";
import { CATEGORY_PLURAL } from "@/lib/types";
import { affinity, entryVector } from "./affinity";
import { blend, topTags } from "./vector";
import { adjective, describeKey } from "./vocabulary";

export type Portrait = {
  headline: string;        // one sentence
  body: string[];          // 1–3 short sentences
  tags: Array<{ key: string; weight: number; label: string }>;
  categoryMix: Array<{ category: Category; share: number; count: number }>;
  centroid: AttributeVector | null;
  entryCount: number;
  lovedCount: number;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** Weighted centroid of what the user loves. */
export function tasteCentroid(entries: EntryWithContext[]): AttributeVector | null {
  const parts = entries
    .map((e) => ({ v: entryVector(e), w: affinity(e) }))
    .filter((p): p is { v: AttributeVector; w: number } => !!p.v && p.w >= 0.45);
  if (parts.length === 0) return null;
  return blend(parts.map((p) => ({ v: p.v, w: p.w * p.w })));
}

export function categoryMix(entries: EntryWithContext[]): Portrait["categoryMix"] {
  const counts: Partial<Record<Category, number>> = {};
  const logged = entries.filter((e) => e.entry.status !== "want");
  for (const e of logged) counts[e.item.category] = (counts[e.item.category] ?? 0) + 1;
  return (Object.entries(counts) as Array<[Category, number]>)
    .map(([category, count]) => ({ category, count, share: count / Math.max(logged.length, 1) }))
    .sort((a, b) => b.count - a.count);
}

/** Top tags relative to the strongest one, so diluted centroids still yield a readable set. */
export function relativeTags(c: AttributeVector, n: number) {
  const all = topTags(c, 12, 0.12);
  const max = all[0]?.weight ?? 1;
  return all.filter((t) => t.weight >= max * 0.45).slice(0, n).map((t) => ({ ...t, label: describeKey(t.key, t.weight) }));
}

/** Editorial, understandable summary of the user's taste right now. */
export function buildPortrait(entries: EntryWithContext[]): Portrait {
  const logged = entries.filter((e) => e.entry.status !== "want");
  const loved = logged.filter((e) => affinity(e) >= 0.7);
  const c = tasteCentroid(entries);
  const mix = categoryMix(entries);
  const tags = c ? relativeTags(c, 5) : [];

  if (logged.length === 0) {
    return { headline: "Your portrait is blank for now.", body: ["Add a few things you have loved and it starts to take shape."], tags, categoryMix: mix, centroid: c, entryCount: 0, lovedCount: 0 };
  }

  const tonal = tags.filter((t) => t.key.startsWith("tone.") || t.key.startsWith("aftertaste.")).slice(0, 2);
  const themes = tags.filter((t) => t.key.startsWith("theme.")).slice(0, 2);
  const pace = c?.pace;
  const ache = c?.ache;

  let headline: string;
  if (tonal.length && themes.length) {
    headline = `You go for the ${list(tonal.map((t) => adjective(t.key)))} — stories ${list(themes.map((t) => adjective(t.key)))}.`;
  } else if (tonal.length) {
    headline = `Right now your taste leans ${list(tonal.map((t) => adjective(t.key)))}.`;
  } else if (themes.length) {
    headline = `The things you love keep circling ${list(themes.map((t) => describeKey(t.key)))}.`;
  } else {
    headline = `${logged.length} things logged across ${mix.length} ${mix.length === 1 ? "category" : "categories"}. Write a few words about one and the portrait sharpens.`;
  }

  const body: string[] = [];
  if (pace !== undefined && pace < 0.4) body.push("You have patience for slow burns.");
  else if (pace !== undefined && pace > 0.7) body.push("You like things that move.");
  if (ache !== undefined && ache > 0.6) body.push("Ache is not a bug for you; it is the point.");
  if (mix.length >= 2) {
    const [first, second] = mix;
    if (first.share > 0.6) body.push(`${cap(CATEGORY_PLURAL[first.category])} take up most of the room, with ${CATEGORY_PLURAL[second.category].toLowerCase()} on the edges.`);
    else body.push(`${cap(CATEGORY_PLURAL[first.category])} and ${CATEGORY_PLURAL[second.category].toLowerCase()} sit side by side; the feeling crosses over more than the categories do.`);
  }
  if (loved.length >= 3 && logged.length >= 6) body.push(`${loved.length} of ${logged.length} really landed.`);

  return { headline, body: body.slice(0, 3), tags, categoryMix: mix, centroid: c, entryCount: logged.length, lovedCount: loved.length };
}
