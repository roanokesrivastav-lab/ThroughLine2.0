// Session 8 §2.2 (SPEC-STAGE3 §3): the first calibration run.
//
//   npm run calibrate                → compute, write CALIBRATION into
//                                      src/lib/taste/calibration.ts, print the table.
//   npm run calibrate -- --dry-run   → print the table, write nothing.
//
// Population (§3.5's mandated first run): every committed canon profile whose category
// is in MATCHED_CATEGORIES and that passes usableProfile at the current PROFILE_VERSION,
// ordered by `canon:<slug>` ascending — 85 non-music items today, music excluded.
// §3.2's database population is the future re-run source and is NOT implemented here.
//
// On ok:false the script prints the error, exits non-zero, and writes nothing.
// On success it rewrites ONLY the CALIBRATION constant as a CalibrationTable, lo/hi
// rounded to 4 decimals. It NEVER edits weights.ts: the f1 → f2 FEATURE_VERSION bump
// is a deliberate hand edit in the same diff (§3.6).
// Deterministic: same day, same population → byte-identical output (§4 step 2).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { calibrate, type CalibrationTable } from "@/lib/taste/calibration";
import { usableProfile } from "@/lib/taste/affinity";
import { MATCHED_CATEGORIES } from "@/lib/taste/profile";
import { simFamily } from "@/lib/taste/vector";
import { candidateKey } from "@/lib/taste/tags";
import type { MediaItem } from "@/lib/types";

const CALIBRATION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "taste", "calibration.ts");

/** The §3.5 population: committed canon profiles, non-music, usable, ordered by key. */
function population(): MediaItem[] {
  const items = CANON.filter((c) => (MATCHED_CATEGORIES as readonly string[]).includes(c.category))
    .map((c) => {
      const r = canonToResult(c);
      return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
    })
    .filter((m) => usableProfile(m) !== null)
    .sort((a, b) => candidateKey(a).localeCompare(candidateKey(b)));
  return items;
}

function table(calId: string, computedAt: string): CalibrationTable {
  const items = population();
  const sim = {
    story: (a: MediaItem, b: MediaItem) => simFamily("story", a.profile!.vector.story ?? {}, b.profile!.vector.story ?? {}),
    feeling: (a: MediaItem, b: MediaItem) => simFamily("feeling", a.profile!.vector.feeling ?? {}, b.profile!.vector.feeling ?? {}),
  };
  const result = calibrate({ items, sim });
  if (!result.ok) {
    console.error(`calibration failed: ${result.error}`);
    process.exit(1);
  }
  const round4 = (n: number) => Number(n.toFixed(4));
  return {
    id: calId,
    computed_at: computedAt,
    n_items: result.n_items,
    n_pairs: result.n_pairs,
    method: result.method,
    story: { lo: round4(result.story.lo), hi: round4(result.story.hi) },
    feeling: { lo: round4(result.feeling.lo), hi: round4(result.feeling.hi) },
  };
}

function render(cal: CalibrationTable): string {
  return `export const CALIBRATION = {
  id: "${cal.id}",
  computed_at: "${cal.computed_at}",
  n_items: ${cal.n_items},
  n_pairs: ${cal.n_pairs},
  method: "${cal.method}",
  story: { lo: ${cal.story.lo}, hi: ${cal.story.hi} },
  feeling: { lo: ${cal.feeling.lo}, hi: ${cal.feeling.hi} },
} as const satisfies CalibrationTable;
`;
}

function rewriteCalibrationConstant(next: string): void {
  const source = readFileSync(CALIBRATION_FILE, "utf8");
  // Replace ONLY the CALIBRATION constant block (§2.2): from its `export const` line to
  // the closing `} as const …;` line (matches both the provisional block and a previously
  // written `as const satisfies CalibrationTable` one). Everything else stays untouched.
  const re = /export const CALIBRATION = \{[\s\S]*?\} as const[^\n]*;\n/;
  if (!re.test(source)) {
    console.error("could not find the CALIBRATION constant block in calibration.ts; wrote nothing");
    process.exit(1);
  }
  writeFileSync(CALIBRATION_FILE, source.replace(re, next));
}

function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const items = population();
  if (items.length === 0) {
    console.error("calibration failed: empty population");
    process.exit(1);
  }
  const computedAt = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const cal = table(`cal-${today}-${items.length}`, computedAt);

  console.log(JSON.stringify(cal, null, 2));
  if (dryRun) {
    console.log("dry run: wrote nothing");
    return;
  }
  rewriteCalibrationConstant(render(cal));
  console.log("bump FEATURE_VERSION");
}

main();
