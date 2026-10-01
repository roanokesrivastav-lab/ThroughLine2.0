// Session 8 §2.3 (SPEC-STAGE3 §D): the offline evaluation CLI.
//
//   npm run eval:recs                  → fixture mode (default): the demo-seed library with
//                                        committed canon profiles, an empty pool, fixed NOW.
//   npm run eval:recs -- --user UUID   → read-only run over one live user's library through
//                                        the RecommendStore-shaped reader. SESSION 9 runs this,
//                                        with the founder present; it is built and stub-tested
//                                        but never run in this session (handoff §0, §8).
//
// Prints ONE JSON object on stdout: { feature_version, calibration_id, library_size,
// d1, d2, d3, d4, d5, closeness }. Redirect it:  npm run eval:recs > docs/qa/eval-<id>.json
//
// Fixture mode is fully offline: committed files only — no database, no network, no model.
import type { PipelineFilters } from "@/lib/taste/filters";
import type { Category, EntryWithContext, MediaItem, Phase } from "@/lib/types";
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { userEvalReader, type EvalReportShape } from "@/lib/dev/eval-user-reader";
import type { RecommendStore } from "@/lib/server/stage-recommend";
import { CALIBRATION } from "@/lib/taste/calibration";
import { generateCandidates } from "@/lib/taste/candidates";
import { filterCandidates } from "@/lib/taste/filters";
import {
  closenessDistribution,
  coldStart,
  coldStartLibrary,
  componentSpread,
  diversityRun,
  leaveOneLovedOut,
  temporalHoldout,
} from "@/lib/taste/eval";
import { buildUserProfile, MATCHED_CATEGORIES } from "@/lib/taste/profile";
import { scoreCandidates } from "@/lib/taste/score";
import { closeness } from "@/lib/taste/rerank";
import { EMPTY_TASTE_PREFS, type TastePrefs } from "@/lib/taste/tags";
import { FEATURE_VERSION, POOL_SIZE } from "@/lib/taste/weights";

/** The fixed eval clock (§2.3) — the same NOW every fixture test uses. */
const NOW = new Date("2026-09-25T12:00:00Z");

const DEFAULTS: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

/** CANON as profiled items (stage-recommend.ts's construction), non-music, ordered by key (§3.2). */
function canonCatalog(): MediaItem[] {
  return CANON.filter((c) => (MATCHED_CATEGORIES as readonly string[]).includes(c.category))
    .map((c) => {
      const r = canonToResult(c);
      return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
    })
    .filter((m) => m.profile !== null)
    .sort((a, b) => (`${a.source}:${a.external_id}`).localeCompare(`${b.source}:${b.external_id}`));
}

/** The full §D run over one library. Pure given its inputs; recency off everywhere (§D). */
function runEval(args: {
  library: EntryWithContext[];
  prefs: TastePrefs;
  phases: Phase[];
  pool: MediaItem[];
  canon: MediaItem[];
  now: Date;
}): EvalReportShape {
  const prefs = args.prefs;
  const { library, phases, pool, canon, now } = args;
  // D.1 leave-one-loved-out, D.2 temporal holdout.
  const d1 = leaveOneLovedOut({ library, phases, prefs, canon, pool, now });
  const d2 = temporalHoldout({ library, phases, prefs, canon, pool, now });
  // D.3 spread over the default request's scored set; also feeds the closeness report.
  const P = buildUserProfile(library, phases, prefs, now);
  const { candidates } = generateCandidates({ library, P, filters: DEFAULTS, canon, creatorResults: new Map(), pool });
  const { kept } = filterCandidates({ candidates, library, prefs, filters: DEFAULTS, recent: [], now });
  const { scored } = scoreCandidates(P, kept);
  const d3 = componentSpread(scored, P);
  // D.4 cold start (the ten-canon-taps construction, unfiltered + one per category),
  // D.5 seven simulated days. Both get the real phases and pool — review P2-5: the
  // earlier calls silently discarded them, describing a different candidate set.
  const d4 = coldStart({ library: coldStartLibrary(library), phases, prefs, canon, pool, now });
  const d5 = diversityRun({ library, phases, prefs, canon, pool, now });
  // §E Q2 input: the closeness distribution at the CURRENT band thresholds.
  const closenessReport = closenessDistribution(scored, closeness);
  return {
    feature_version: FEATURE_VERSION,
    calibration_id: CALIBRATION.id,
    library_size: library.length,
    d1: { hit5: d1.hit5, hit20: d1.hit20, mrr: d1.mrr, median_rank: d1.median_rank, n: d1.n, excluded: d1.excluded, rows: d1.rows },
    d2,
    d3,
    d4,
    d5,
    closeness: closenessReport,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const userFlag = argv.indexOf("--user");

  if (userFlag !== -1) {
    // ---- --user mode: read-only, service role, SESSION 9 ONLY (never run in Session 8). ----
    const userId = argv[userFlag + 1];
    if (!userId || userId.startsWith("--")) throw new Error("usage: eval-recs --user <uuid>");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !service) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --user mode");
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, service, { auth: { persistSession: false } });
    const store: RecommendStore = userEvalReader(db as never, userId);
    const library = await store.loadLibrary(userId);
    const prefs = await store.loadPrefs(userId);
    const phases = await store.loadPhases(userId);
    // Live-pipeline parity (review P2-5): the same POOL_SIZE the stage server loads.
    const pool = await store.loadPool([...MATCHED_CATEGORIES] as Category[], POOL_SIZE);
    const report = runEval({ library, prefs, phases, pool, canon: canonCatalog(), now: new Date() });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ---- fixture mode (default): the demo-seed library with committed canon profiles. ----
  const library = buildFixtureLibrary(NOW.getTime(), { profiles: "canon" });
  const report = runEval({ library, prefs: EMPTY_TASTE_PREFS, phases: [], pool: [], canon: canonCatalog(), now: NOW });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
