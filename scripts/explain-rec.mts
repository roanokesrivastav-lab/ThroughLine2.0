// Session 8 §2.4 (AUDIT-STAGE3 §5.3): the debugging script for one candidate's score.
//
//   npm run explain:rec --                        → the top 5 of the default fixture request.
//   npm run explain:rec -- "Aftersun"             → the explainScore table for the fixture
//                                                    candidate whose title matches.
//
// Fixture mode only; a --user mode is Session 9's to add if wanted (handoff §2.4).
// Offline: committed files only — no database, no network, no model.
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { explainScore } from "@/lib/taste/eval";
import { generateCandidates } from "@/lib/taste/candidates";
import { filterCandidates, type PipelineFilters } from "@/lib/taste/filters";
import { buildUserProfile, MATCHED_CATEGORIES } from "@/lib/taste/profile";
import { scoreCandidates } from "@/lib/taste/score";
import { norm } from "@/lib/catalog/canon";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";

const NOW = new Date("2026-09-25T12:00:00Z");
const DEFAULTS: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

function canonCatalog() {
  return CANON.filter((c) => (MATCHED_CATEGORIES as readonly string[]).includes(c.category))
    .map((c) => {
      const r = canonToResult(c);
      return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
    })
    .filter((m) => m.profile !== null);
}

function scoredDefault() {
  const library = buildFixtureLibrary(NOW.getTime(), { profiles: "canon" });
  const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);
  const { candidates } = generateCandidates({ library, P, filters: DEFAULTS, canon: canonCatalog(), creatorResults: new Map(), pool: [] });
  const { kept } = filterCandidates({ candidates, library, prefs: EMPTY_TASTE_PREFS, filters: DEFAULTS, recent: [], now: NOW });
  const { scored } = scoreCandidates(P, kept);
  // The full ranked set: a title lookup must find any fixture candidate, not just the top 5.
  return { library, P, scored: [...scored].sort((a, b) => b.score - a.score || a.candidate.key.localeCompare(b.candidate.key)) };
}

/** entryId → the anchor entry's title, for readable debug output (the report carries the entryId). */
function titleFor(library: ReturnType<typeof buildFixtureLibrary>, entryId: string): string | null {
  return library.find((e) => e.entry.id === entryId)?.item.title ?? null;
}

function printRow(r: {
  component: string; raw: { centroid: number; anchor: number } | null; calibrated: number; weight: number; contribution: number; has_evidence: boolean;
}) {
  const raw = r.raw ? `centroid=${r.raw.centroid.toFixed(4)} anchor=${r.raw.anchor.toFixed(4)}` : "—";
  console.log(
    `  ${r.component.padEnd(8)} raw[${raw}]  cal=${r.calibrated.toFixed(4)}  w=${r.weight.toFixed(2)}  contrib=${r.contribution.toFixed(4)}  evidence=${r.has_evidence ? "yes" : "no"}`,
  );
}

function main() {
  const title = process.argv.slice(2).filter((a) => a !== "--fixture").join(" ").trim();
  const { library, P, scored } = scoredDefault();
  const top5 = scored.slice(0, DEFAULTS.limit);

  if (!title) {
    console.log(`top ${top5.length} of the default fixture request (feature explains the score, not the order):`);
    for (const s of top5) {
      const rep = explainScore(P, s);
      console.log(`\n${s.candidate.key}  "${rep.title}"  score=${s.score.toFixed(4)}  via ${rep.provenance.join(", ") || "(injected)"}`);
      for (const row of rep.rows) printRow(row);
      for (const family of ["story", "feeling"] as const) {
        const a = rep.anchors[family];
        if (a) console.log(`  ${family} anchor: "${titleFor(library, a.entryId) ?? a.entryId}" raw=${a.raw.toFixed(4)} cal=${a.calibrated.toFixed(4)}`);
      }
    }
    return;
  }

  const want = norm(title);
  let hit: ReturnType<typeof scoreCandidates>["scored"][number] | null | undefined = scored.find((s) => norm(s.candidate.item.title) === want)
    ?? scored.find((s) => norm(s.candidate.item.title).includes(want));
  if (!hit) {
    // The D.1 construction (eval.ts): library entries themselves — often the most-loved
    // titles, like Aftersun — are excluded from candidates by the logged filter. To
    // explain one of those, score it as an eval holdout: rebuilt profile without it,
    // injected with empty provenance, recency off. Labeled as eval-only in the output.
    const inLibrary = library.find((e) => norm(e.item.title) === want) ?? library.find((e) => norm(e.item.title).includes(want));
    if (inLibrary) {
      const holdouts = [inLibrary];
      const train = library.filter((e) => e.entry.id !== inLibrary.entry.id);
      const Pe = buildUserProfile(train, [], EMPTY_TASTE_PREFS, NOW);
      const { candidates } = generateCandidates({ library: train, P: Pe, filters: DEFAULTS, canon: canonCatalog(), creatorResults: new Map(), pool: [] });
      const injected = holdouts
        .filter((h) => !candidates.some((c) => c.key === `${h.item.source}:${h.item.external_id}`))
        .map((h) => ({
          key: `${h.item.source}:${h.item.external_id}`,
          item: h.item,
          entryId: null,
          sources: [],
          creatorKey: h.item.creators[0] ? `${h.item.category}:${h.item.creators[0].name.toLowerCase()}` : null,
        }));
      const { kept } = filterCandidates({ candidates: [...candidates, ...injected], library: train, prefs: EMPTY_TASTE_PREFS, filters: DEFAULTS, recent: [], now: NOW });
      const { scored: scoredEval } = scoreCandidates(Pe, kept);
      hit = scoredEval.find((s) => s.candidate.key === `${inLibrary.item.source}:${inLibrary.item.external_id}`) ?? null;
      if (hit) {
        const rep = explainScore(Pe, hit);
        console.log(`${rep.key}  "${rep.title}"  score=${rep.score.toFixed(4)}  provenance=${rep.provenance.join(", ") || "(injected — eval holdout construction)"}`);
        console.log(`calibration ${JSON.stringify(rep.calibration)}`);
        for (const row of rep.rows) printRow(row);
        for (const family of ["story", "feeling"] as const) {
          const a = rep.anchors[family];
          if (a) console.log(`${family} anchor: "${titleFor(train, a.entryId) ?? a.entryId}" raw=${a.raw.toFixed(4)} cal=${a.calibrated.toFixed(4)}`);
          for (const sh of rep.shared[family]) {
            console.log(`  shared ${family}: ${sh.key}  a=${sh.a.toFixed(3)} b=${sh.b.toFixed(3)} w=${sh.weight.toFixed(4)}`);
          }
        }
        return;
      }
    }
  }
  if (!hit) {
    console.error(`no candidate titled "${title}" in the default fixture request (${scored.length} candidates)`);
    process.exit(1);
  }
  const rep = explainScore(P, hit);
  console.log(`${rep.key}  "${rep.title}"  score=${rep.score.toFixed(4)}  provenance=${rep.provenance.join(", ") || "(injected)"}`);
  console.log(`calibration ${JSON.stringify(rep.calibration)}`);
  for (const row of rep.rows) printRow(row);
  for (const family of ["story", "feeling"] as const) {
    const a = rep.anchors[family];
    if (a) console.log(`${family} anchor: "${titleFor(library, a.entryId) ?? a.entryId}" raw=${a.raw.toFixed(4)} cal=${a.calibrated.toFixed(4)}`);
    for (const s of rep.shared[family]) {
      console.log(`  shared ${family}: ${s.key}  a=${s.a.toFixed(3)} b=${s.b.toFixed(3)} w=${s.weight.toFixed(4)}`);
    }
  }
}

main();
