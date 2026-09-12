import type { AttributeVector, Category, EntryWithContext, Phase } from "@/lib/types";
import { CATEGORY_PLURAL } from "@/lib/types";
import { affinity, entryDate, entryVector } from "./affinity";
import { centroid, topTags } from "./vector";
import { describeKey } from "./vocabulary";
import { isTooBroadForPhases, normaliseTags } from "./tag-lexicon";

export type DetectedPhase = Omit<Phase, "id" | "user_id" | "user_label" | "dismissed" | "detected_at"> & {
  entryIds: string[];
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function season(d: Date): string {
  const m = d.getUTCMonth();
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}
function seasonLabel(start: Date, end: Date): string {
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const s = season(mid);
  const y = s === "winter" && mid.getUTCMonth() === 11 ? mid.getUTCFullYear() + 1 : mid.getUTCFullYear();
  return `${s} ${y}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function spanDays(items: EntryWithContext[]): number {
  const ts = items.map((e) => entryDate(e).getTime());
  return (Math.max(...ts) - Math.min(...ts)) / DAY;
}
function confidence(count: number, days: number, windowDays: number, extra = 0): number {
  const density = Math.min(1, count / 6);
  const tightness = 1 - Math.min(1, days / windowDays) * 0.5;
  return Math.round(Math.max(0.3, Math.min(0.97, 0.35 + density * 0.4 + tightness * 0.2 + extra)) * 1000) / 1000;
}
function make(kind: Phase["kind"], fingerprint: string, label: string, items: EntryWithContext[], category: Category | null, conf: number, evidence: Record<string, unknown>): DetectedPhase {
  const dates = items.map(entryDate).sort((a, b) => a.getTime() - b.getTime());
  return {
    kind, fingerprint, label, category, confidence: conf, evidence,
    start_at: iso(dates[0]), end_at: iso(dates[dates.length - 1]),
    entryIds: items.map((e) => e.entry.id),
  };
}

/** Greedy sliding-window clustering: returns groups of ≥ min items whose dates fit in windowDays. */
function clusterByTime(items: EntryWithContext[], windowDays: number, min: number): EntryWithContext[][] {
  const sorted = [...items].sort((a, b) => entryDate(a).getTime() - entryDate(b).getTime());
  const groups: EntryWithContext[][] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && entryDate(sorted[j + 1]).getTime() - entryDate(sorted[i]).getTime() <= windowDays * DAY) j++;
    const group = sorted.slice(i, j + 1);
    if (group.length >= min) {
      groups.push(group);
      i = j + 1;
    } else i++;
  }
  return groups;
}

/** Nouns that read well after "Autumn 2025:". */
const CLUSTER_NOUN: Record<string, string> = {
  "aftertaste.lingering": "things that lingered", "aftertaste.haunting": "hauntings", "aftertaste.comforting": "comfort",
  "aftertaste.unsettling": "unease", "aftertaste.bittersweet": "bittersweetness", "aftertaste.cathartic": "catharsis",
  "aftertaste.hopeful": "hope", "aftertaste.numb": "numbness", "aftertaste.energized": "energy", "aftertaste.devastating": "devastation",
  ache: "ache",
};
function clusterNoun(key: string): string {
  return CLUSTER_NOUN[key] ?? describeKey(key);
}

const CREATOR_ROLE: Record<Category, string> = { movie: "director", tv: "creator", anime: "creator", book: "author", music: "artist" };

/**
 * Engine B. Phases are inferred from density; the user never creates them.
 * Kinds: creator runs (incl. artist phases), album rollups, category stretches,
 * feeling clusters (shared extracted attributes), and genre runs.
 */
export function detectPhases(all: EntryWithContext[]): DetectedPhase[] {
  const entries = all.filter((e) => e.entry.status !== "want");
  if (entries.length < 3) return [];
  const out: DetectedPhase[] = [];

  // 1. Creator runs / artist phases: ≥3 by the same creator within 75 days.
  const byCreator = new Map<string, { name: string; category: Category; items: EntryWithContext[] }>();
  for (const e of entries) {
    const role = CREATOR_ROLE[e.item.category];
    const c = e.item.creators.find((x) => x.role === role) ?? e.item.creators[0];
    if (!c?.name) continue;
    const key = `${e.item.category}:${c.name.toLowerCase()}`;
    const g = byCreator.get(key) ?? { name: c.name, category: e.item.category, items: [] };
    g.items.push(e);
    byCreator.set(key, g);
  }
  for (const [key, g] of byCreator) {
    for (const group of clusterByTime(g.items, 75, 3)) {
      const label = g.category === "music" ? `A ${g.name} phase` : `A ${g.name} run`;
      out.push(make("creator_run", `creator:${key}:${iso(entryDate(group[0]))}`, label, group, g.category,
        confidence(group.length, spanDays(group), 75, 0.05), { creator: g.name, count: group.length }));
    }
  }

  // 2. Album rollups: ≥3 songs from one album, any time span.
  const byAlbum = new Map<string, EntryWithContext[]>();
  for (const e of entries) {
    if (e.item.category !== "music") continue;
    const album = (e.item.metadata.album as string | undefined)?.trim();
    if (!album) continue;
    const artist = e.item.creators.find((c) => c.role === "artist")?.name ?? e.item.subtitle ?? "";
    const key = `${artist.toLowerCase()}::${album.toLowerCase()}`;
    byAlbum.set(key, [...(byAlbum.get(key) ?? []), e]);
  }
  for (const [key, group] of byAlbum) {
    if (group.length < 3) continue;
    const album = group[0].item.metadata.album as string;
    out.push(make("album", `album:${key}`, album, group, "music",
      confidence(group.length, spanDays(group), 365, 0.15), { album, artist: group[0].item.subtitle, count: group.length }));
  }

  // 3. Category stretches: ≥4 of one category in 45 days, well above the user's baseline share.
  const share: Record<string, number> = {};
  for (const e of entries) share[e.item.category] = (share[e.item.category] ?? 0) + 1 / entries.length;
  for (const cat of Object.keys(share) as Category[]) {
    const items = entries.filter((e) => e.item.category === cat);
    for (const group of clusterByTime(items, 45, 4)) {
      const start = entryDate(group[0]).getTime(), end = entryDate(group[group.length - 1]).getTime();
      const inWindow = entries.filter((e) => { const t = entryDate(e).getTime(); return t >= start && t <= end; });
      const localShare = group.length / Math.max(inWindow.length, 1);
      if (localShare < Math.min(0.9, Math.max(0.5, share[cat] * 1.6))) continue;
      out.push(make("category_stretch", `cat:${cat}:${iso(new Date(start))}`, `${cap(CATEGORY_PLURAL[cat])} stretch, ${seasonLabel(new Date(start), new Date(end))}`,
        group, cat, confidence(group.length, spanDays(group), 45, localShare > 0.75 ? 0.08 : 0), { category: cat, share: localShare, count: group.length }));
    }
  }

  // 4. Genre runs: ≥3 sharing a genre tag within 45 days (cross-media allowed).
  const byGenre = new Map<string, EntryWithContext[]>();
  for (const e of entries) for (const g of normaliseTags(e.item.genre_tags)) {
    if (isTooBroadForPhases(g)) continue; // a phase needs a tag that means something on its own
    byGenre.set(g, [...(byGenre.get(g) ?? []), e]);
  }
  for (const [genre, items] of byGenre) {
    for (const group of clusterByTime(items, 45, 3)) {
      const cats = new Set(group.map((e) => e.item.category));
      out.push(make("genre_run", `genre:${genre}:${iso(entryDate(group[0]))}`, `A ${genre} run`, group,
        cats.size === 1 ? [...cats][0] : null, confidence(group.length, spanDays(group), 45), { genre, count: group.length }));
    }
  }

  // 5. Feeling clusters: ≥4 loved entries within 60 days that share a dominant attribute.
  const withVec = entries
    .map((e) => ({ e, v: entryVector(e), aff: affinity(e) }))
    .filter((x): x is { e: EntryWithContext; v: AttributeVector; aff: number } => !!x.v && x.aff >= 0.55);
  for (const group of clusterByTime(withVec.map((x) => x.e), 60, 4)) {
    const vecs = group.map((e) => entryVector(e)!).filter(Boolean);
    const c = centroid(vecs);
    const candidates = topTags(c, 4, 0.35).filter((t) => t.key.startsWith("theme.") || t.key.startsWith("aftertaste.") || t.key.startsWith("tone."));
    if ((c.ache ?? 0) >= 0.65) candidates.unshift({ key: "ache", weight: c.ache });
    if (candidates.length === 0) continue;
    // Pick the candidate most of the group agrees on.
    let best: { key: string; weight: number; members: EntryWithContext[] } | null = null;
    for (const t of candidates) {
      const members = group.filter((e) => (entryVector(e)?.[t.key] ?? 0) >= (t.key === "ache" ? 0.6 : 0.4));
      if (!best || members.length > best.members.length) best = { key: t.key, weight: t.weight, members };
    }
    if (!best || best.members.length < 3 || best.members.length < Math.ceil(group.length * 0.5)) continue;
    const agreeing = best.members;
    const second = candidates.find((t) => t.key !== best!.key && agreeing.filter((e) => (entryVector(e)?.[t.key] ?? 0) >= 0.4).length >= Math.ceil(agreeing.length * 0.5));
    const start = entryDate(agreeing[0]), end = entryDate(agreeing[agreeing.length - 1]);
    const cats = new Set(agreeing.map((e) => e.item.category));
    const label = `${cap(seasonLabel(start, end))}: ${clusterNoun(best.key)}${second ? ` and ${clusterNoun(second.key)}` : ""}`;
    out.push(make("feeling_cluster", `feel:${best.key}:${iso(start)}`, label, agreeing,
      cats.size === 1 ? [...cats][0] : null,
      confidence(agreeing.length, spanDays(agreeing), 60, cats.size > 1 ? 0.1 : 0),
      { dominant: best.key, second: second?.key ?? null, categories: [...cats], count: agreeing.length }));
  }

  // Drop near-duplicates (same members, different kind): keep the more specific one.
  const specificity: Record<Phase["kind"], number> = { album: 5, creator_run: 4, feeling_cluster: 3, genre_run: 2, category_stretch: 1 };
  out.sort((a, b) => specificity[b.kind] - specificity[a.kind] || b.confidence - a.confidence);
  const kept: DetectedPhase[] = [];
  for (const p of out) {
    const set = new Set(p.entryIds);
    const dup = kept.some((k) => {
      const overlap = k.entryIds.filter((id) => set.has(id)).length;
      return overlap / Math.max(set.size, k.entryIds.length) >= 0.8;
    });
    if (!dup) kept.push(p);
  }
  return kept.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export function confidenceLabel(c: number): "tentative" | "likely" | "strong" {
  return c < 0.5 ? "tentative" : c < 0.72 ? "likely" : "strong";
}
