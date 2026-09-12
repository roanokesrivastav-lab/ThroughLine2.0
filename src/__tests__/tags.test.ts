import { describe, expect, it } from "vitest";
import {
  isTooBroadForPhases,
  listTags,
  normaliseTag,
  normaliseTags,
  tagFamily,
  tagSpecificity,
} from "@/lib/taste/tag-lexicon";
import {
  availableTags,
  buildTagProfile,
  creatorMatch,
  isMuted,
  tagOverlap,
  type TastePrefs,
} from "@/lib/taste/tags";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import type { EntryWithContext, MediaItem } from "@/lib/types";

const NOW = Date.UTC(2026, 8, 10);
const lib = buildFixtureLibrary(NOW);

describe("tag normalisation", () => {
  it("canonicalises the ways providers spell the same thing", () => {
    expect(normaliseTag("Science Fiction")).toBe("sci-fi");
    expect(normaliseTag("sci-fi & fantasy")).toBe("sci-fi");
    expect(normaliseTag("Hip-Hop")).toBe("hip hop");
    expect(normaliseTag("Singer/Songwriter")).toBe("singer-songwriter");
    expect(normaliseTag("  Coming of Age  ")).toBe("coming-of-age");
    expect(normaliseTag("Autobiography")).toBe("memoir");
  });

  it("drops tags that carry nothing", () => {
    for (const t of ["Drama", "fiction", "Classic", "TV Movie", "", "  ", "general"]) {
      expect(normaliseTag(t)).toBeNull();
    }
  });

  it("survives punctuation and accents", () => {
    expect(normaliseTag("R&B")).toBe("r&b");
    expect(normaliseTag("film noir")).toBe("noir");
    expect(normaliseTag("Indie   Folk")).toBe("indie folk");
  });

  it("de-duplicates an array and keeps order", () => {
    expect(normaliseTags(["Folk", "folk", "Science Fiction", "drama"])).toEqual(["folk", "sci-fi"]);
  });

  it("credits broader tags a specific one implies, at a decay", () => {
    const family = tagFamily("indie folk");
    expect(family[0]).toEqual({ tag: "indie folk", factor: 1 });
    expect(family.map((f) => f.tag)).toContain("folk");
    expect(family.find((f) => f.tag === "folk")!.factor).toBeLessThan(1);
    // Single level only: folk has no parents, so the walk stops.
    expect(tagFamily("folk")).toHaveLength(1);
  });

  it("rates specific tags above broad ones", () => {
    expect(tagSpecificity("indie folk")).toBeGreaterThan(tagSpecificity("folk"));
    expect(tagSpecificity("folk")).toBeGreaterThan(tagSpecificity("rock"));
    expect(tagSpecificity("a tag nobody has mapped")).toBeGreaterThan(0);
  });

  it("shares one definition of too-broad with phase detection", () => {
    expect(isTooBroadForPhases("drama")).toBe(true);
    expect(isTooBroadForPhases("rock")).toBe(true);
    expect(isTooBroadForPhases("pop")).toBe(true);
    expect(isTooBroadForPhases("indie folk")).toBe(false);
    expect(isTooBroadForPhases("noir")).toBe(false);
  });

  it("renders a readable list", () => {
    expect(listTags(["folk"])).toBe("folk");
    expect(listTags(["folk", "singer-songwriter"])).toBe("folk and singer-songwriter");
    expect(listTags(["folk", "jazz", "noir"])).toBe("folk, jazz and noir");
  });
});

describe("tag profile", () => {
  const profile = buildTagProfile(lib);

  it("is derived from the library, not declared", () => {
    expect(profile.evidence.entries).toBeGreaterThan(20);
    expect(profile.evidence.taggedEntries).toBeGreaterThan(20);
    expect(profile.tags.size).toBeGreaterThan(8);
    // The demo library is folk-heavy and grief-heavy; the profile should say so.
    expect(profile.tags.get("indie folk")!.weight).toBeGreaterThan(0.3);
    expect(profile.tags.get("folk")!.weight).toBeGreaterThan(0.3);
  });

  it("weights a loved thing above a merely seen one", () => {
    const loved = makeEntry("loved", ["noir"], { loved: true });
    const seen = makeEntry("seen", ["mecha"], {});
    const p = buildTagProfile([loved, seen]);
    expect(p.tags.get("noir")!.weight).toBeGreaterThan(p.tags.get("mecha")!.weight);
  });

  it("lets a dropped thing count against, with a lighter hand than a loved one counts for", () => {
    const dropped = { ...makeEntry("d", ["western"], {}), entry: { ...makeEntry("d", ["western"], {}).entry, status: "dropped" as const } };
    const p = buildTagProfile([dropped]);
    expect(p.tags.has("western")).toBe(false); // negative evidence never becomes a positive weight
    const both = buildTagProfile([dropped, makeEntry("l", ["western"], { loved: true })]);
    expect(both.tags.get("western")!.weight).toBeGreaterThan(0);
  });

  it("never rules out a whole kind of thing from one abandonment", () => {
    const base = buildTagProfile(lib);
    const oneDrop = makeEntry("drop-folk", ["indie folk"], {});
    oneDrop.entry.status = "dropped";
    const after = buildTagProfile([...lib, oneDrop]);
    expect(after.tags.get("indie folk")!.weight).toBeGreaterThan(base.tags.get("indie folk")!.weight * 0.75);
  });

  it("honours pinned and muted tags", () => {
    const prefs: TastePrefs = { pinned: ["Noir"], muted: ["indie folk"], hidden: [] };
    const p = buildTagProfile(lib, prefs);
    expect(p.tags.get("noir")!.pinned).toBe(true);
    expect(p.tags.get("noir")!.weight).toBeGreaterThanOrEqual(0.8);
    expect(p.tags.has("indie folk")).toBe(false);
    expect(p.muted.has("indie folk")).toBe(true);
  });

  it("collects creators with repeat evidence weighted higher", () => {
    const ishiguro = [...profile.creators.values()].find((c) => c.name.includes("Ishiguro"));
    expect(ishiguro).toBeDefined();
    expect(ishiguro!.entryIds.length).toBeGreaterThanOrEqual(2);
    const oneOff = [...profile.creators.values()].find((c) => c.entryIds.length === 1);
    if (oneOff) expect(ishiguro!.weight).toBeGreaterThan(oneOff.weight);
  });

  it("is deterministic", () => {
    const a = buildTagProfile(lib);
    const b = buildTagProfile(lib);
    expect([...a.tags.entries()]).toEqual([...b.tags.entries()]);
  });

  it("offers the user's own vocabulary for the settings picker", () => {
    const available = availableTags(profile, 10);
    expect(available.length).toBeGreaterThan(3);
    expect(available.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < available.length; i++) expect(available[i - 1].weight).toBeGreaterThanOrEqual(available[i].weight);
  });
});

describe("tag overlap", () => {
  const profile = buildTagProfile(lib);

  it("scores an item made entirely of things you like above one that merely brushes them", () => {
    const focused = tagOverlap(["indie folk", "singer-songwriter"], profile);
    const diluted = tagOverlap(["indie folk", "sports", "mecha", "western", "documentary", "philosophy"], profile);
    expect(focused.score).toBeGreaterThan(diluted.score);
    expect(focused.coverage).toBeGreaterThan(diluted.coverage);
  });

  it("rewards more matched evidence when the profile likes it too", () => {
    const one = tagOverlap(["folk"], profile);
    const several = tagOverlap(["folk", "indie folk"], profile);
    expect(several.score).toBeGreaterThan(one.score);
  });

  it("dilutes when an extra tag is one the profile does not care about", () => {
    const clean = tagOverlap(["indie folk"], profile);
    const padded = tagOverlap(["indie folk", "sports"], profile);
    expect(padded.score).toBeLessThan(clean.score);
    expect(padded.coverage).toBeLessThan(clean.coverage);
  });

  it("matches through a parent tag and says which tag it came via", () => {
    const p = buildTagProfile([makeEntry("a", ["folk"], { loved: true })]);
    const o = tagOverlap(["indie folk"], p);
    expect(o.score).toBeGreaterThan(0);
    expect(o.matched[0].tag).toBe("folk");
    expect(o.matched[0].via).toBe("indie folk");
  });

  it("returns zero for an item with no tags and for a profile that shares none", () => {
    expect(tagOverlap([], profile).score).toBe(0);
    expect(tagOverlap(["drama"], profile).score).toBe(0);
    expect(tagOverlap(["mecha"], buildTagProfile([makeEntry("a", ["philosophy"], { loved: true })])).score).toBe(0);
  });

  it("stays within 0..1 and explains every point it awarded", () => {
    for (const tags of [["folk"], ["indie folk", "folk"], ["jazz", "blues", "classical"], ["noir", "crime", "thriller"]]) {
      const o = tagOverlap(tags, profile);
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(1);
      if (o.score > 0) expect(o.matched.length).toBeGreaterThan(0);
      for (const m of o.matched) expect(m.contribution).toBeGreaterThan(0);
    }
  });

  it("treats muted tags as a filter", () => {
    const p = buildTagProfile(lib, { pinned: [], muted: ["noir"], hidden: [] });
    expect(isMuted(["noir", "crime"], p)).toBe(true);
    expect(isMuted(["crime"], p)).toBe(false);
  });

  it("finds the creator behind an item", () => {
    const ishiguroEntry = lib.find((e) => e.item.subtitle?.includes("Ishiguro"));
    expect(ishiguroEntry).toBeDefined();
    const match = creatorMatch(ishiguroEntry!.item, profile);
    expect(match?.name).toContain("Ishiguro");
    expect(match!.weight).toBeGreaterThan(0);
  });
});

/** A minimal entry for testing derivation rules in isolation. */
function makeEntry(id: string, genres: string[], dims: Record<string, boolean>): EntryWithContext {
  const item: MediaItem = {
    id: `item-${id}`,
    category: "movie",
    title: `Title ${id}`,
    subtitle: `Maker ${id}`,
    source: "test",
    external_id: id,
    image_url: null,
    release_year: 2020,
    creators: [{ name: `Maker ${id}`, role: "director" }],
    genre_tags: genres,
    metadata: {},
    feel_prior: null,
  };
  const created = new Date(NOW - 30 * 86_400_000).toISOString();
  return {
    entry: {
      id: `entry-${id}`, user_id: "u", media_item_id: item.id, status: "completed",
      private_score: null, consumed_at: created.slice(0, 10), origin: "log", created_at: created, updated_at: created,
    },
    item,
    reactions: Object.keys(dims).length
      ? [{ id: `r-${id}`, entry_id: `entry-${id}`, user_id: "u", dimensions: dims, raw_note: null, source: "log", created_at: created }]
      : [],
    extractions: [],
    resurfaces: [],
  };
}
