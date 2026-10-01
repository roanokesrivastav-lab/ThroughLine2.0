// §C45: the golden regression. The keys of the default fixture request's five displayed
// recommendations at the fixed NOW are pinned together with the feature version that
// produced them — any change forces a deliberate golden update that names the new version.
// The keys come from rankPipeline().snapshots — the FULL selection, re-rank included —
// so a change to quotas, caps or bridge repair that alters what is displayed breaks this
// test even though every raw score is unchanged (review P2-3).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { generateCandidates } from "@/lib/taste/candidates";
import { type PipelineFilters } from "@/lib/taste/filters";
import { rankPipeline } from "@/lib/taste/pipeline";
import { buildUserProfile } from "@/lib/taste/profile";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import { FEATURE_VERSION } from "@/lib/taste/weights";

const golden = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "top5.json"), "utf8"),
) as { feature_version: string; calibration_id: string; now: string; keys: string[] };

describe("golden regression (test I, §C45)", () => {
  it("rankPipeline's displayed top-5 keys equal golden/top5.json.keys at the pinned feature version", () => {
    expect(golden.feature_version).toBe(FEATURE_VERSION);

    const NOW = new Date(golden.now);
    const filters: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };
    const lib = buildFixtureLibrary(NOW.getTime(), { profiles: "canon" });
    const P = buildUserProfile(lib, [], EMPTY_TASTE_PREFS, NOW);
    const canon = CANON.filter((c) => c.category !== "music").map((c) => {
      const r = canonToResult(c);
      return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
    });
    const { candidates, sourceCounts, merged } = generateCandidates({ library: lib, P, filters, canon, creatorResults: new Map(), pool: [] });
    const { snapshots } = rankPipeline({
      P, library: lib, prefs: EMPTY_TASTE_PREFS, candidates, filters, recent: [], userId: "golden", now: NOW, sourceCounts, merged,
    });
    expect(snapshots.map((s) => s.key)).toEqual(golden.keys);
  });
});
