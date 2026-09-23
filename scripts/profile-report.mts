// Session 3 §2.5: profiling QA report. No model calls. Reads the committed
// CANON_PROFILES, CANON and the cache; writes three files under docs/qa/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CACHE_DIR } from "@/lib/dev/profiling-run";
import { promptHash as promptHashOf } from "@/lib/dev/profiling-run";
import {
  categoryArtifacts,
  evaluate,
  groupFill,
  prevalence,
  QA_THRESHOLDS,
  type PrevalenceRow,
} from "@/lib/taste/qa";
import { PROFILE_SYSTEM_PROMPT, PROFILE_CAPS } from "@/lib/ai/profile-contract";
import { nvidiaModel } from "@/lib/ai/nvidia";
import { CANON, CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { CANON_PROFILES } from "@/lib/catalog/canon-profiles";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import type { Category, ItemProfile } from "@/lib/types";

const PRAISE =
  /\b(masterpiece|acclaimed|award|awards|award-winning|oscar|emmy|best-selling|bestseller|beloved|critically|critics?|masterful|must-see|popular|hit)\b/i;

const categories: Category[] = ["movie", "tv", "anime", "book", "music"];
const today = new Date().toISOString().slice(0, 10);
const promptHashValue = promptHashOf(PROFILE_SYSTEM_PROMPT);

type CacheEntryLike = { attempts?: number; first_attempt_ok?: boolean; error?: string | null; draft?: unknown };

const readCacheEntry = (slug: string): CacheEntryLike | null => {
  const file = `${CACHE_DIR}/${slug}.json`;
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CacheEntryLike;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

const profiled: Array<{ slug: string; category: Category; profile: ItemProfile; cache: CacheEntryLike | null }> = [];
const failedSlugs: string[] = [];
const unreached: string[] = [];
for (const c of CANON) {
  const profile = CANON_PROFILES[c.slug];
  const cache = readCacheEntry(c.slug);
  if (profile) profiled.push({ slug: c.slug, category: c.category, profile, cache });
  else if (cache && cache.error) failedSlugs.push(c.slug);
  else unreached.push(c.slug);
}

const firstAttemptOk = profiled.filter((p) => p.cache?.first_attempt_ok === true).length;
const firstPassStrict = profiled.length ? firstAttemptOk / profiled.length : 0;

// Prevalence and artifacts (music included; reported separately as well).
const items = profiled.map((p) => ({ category: p.category, profile: p.profile }));
const rows = prevalence(items);
const totals: Partial<Record<Category, number>> = {};
for (const p of profiled) totals[p.category] = (totals[p.category] ?? 0) + 1;
const artifacts = categoryArtifacts(rows, totals);
const reviewKeys = rows.filter((r) => r.global > QA_THRESHOLDS.prevalenceFlag);
const singletonKeys = rows.filter((r) => r.global * profiled.length === 1).length;

const fill = groupFill(items);

const meanConfidence = (family: "story" | "feeling") => {
  const all = profiled.flatMap((p) => p.profile[family].map((a) => a.confidence));
  return all.length ? all.reduce((s, n) => s + n, 0) / all.length : 0;
};

// Premise stats.
const premiseNull = profiled.filter((p) => p.profile.premise === null).length;
let praiseDrops = 0;
for (const p of profiled) {
  const draft = p.cache?.draft as { premise?: string | null } | null | undefined;
  if (p.profile.premise === null && draft?.premise && !PRAISE.test("") && draft.premise.trim() && PRAISE.test(draft.premise)) praiseDrops++;
}

const failureReasons = new Map<string, number>();
for (const slug of failedSlugs) {
  const raw = readCacheEntry(slug)?.error ?? "unknown";
  const reason = raw.split(";")[0].slice(0, 120);
  failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
}

const maxPrevalence = rows.length ? rows[0].global : 0;
const evaluateRows = evaluate({
  firstPassStrict,
  committedStrict: profiled.length ? 1 : 0,
  agreementStory: null,
  agreementFeeling: null,
  scalarMae: null,
  maxPrevalence,
});

// Music separately (profiled, never matched — DECISIONS #50).
const musicItems = profiled.filter((p) => p.category === "music");
const musicRows = prevalence(musicItems.map((p) => ({ category: p.category, profile: p.profile })));

// ---------------------------------------------------------------------------
// Review sample: the first 4 canon items of each category in CANON order (20 items).
// ---------------------------------------------------------------------------

const sample: typeof profiled = [];
for (const category of categories) {
  for (const p of profiled.filter((x) => x.category === category).slice(0, 4)) sample.push(p);
}

const topKeys = (profile: ItemProfile, family: "story" | "feeling", n: number, omitSpoilers: boolean) =>
  Object.entries(profile.vector[family])
    .filter(([key]) => !(omitSpoilers && key.startsWith("ending.")))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, value]) => `${key} ${value.toFixed(2)}`);

const reviewLines: string[] = [
  `# Canon profile hand-review sheet`,
  ``,
  `Generated ${today} from the committed canon profiles (model ${nvidiaModel()}, ${PROFILE_VERSION}).`,
  `Sample: the first 4 canon items of each category in CANON order (${sample.length} items).`,
  ``,
  `For each item: does the profile read like the work? Mark Verdict and add notes.`,
  ``,
];

for (const p of sample) {
  const c = CANON_BY_SLUG.get(p.slug)!;
  const item = { ...canonToResult(c), id: `canon:${c.slug}`, feel_prior: null };
  reviewLines.push(
    `## ${c.title} (${c.category})`,
    `- Creator: ${c.subtitle} · Year: ${c.year} · Genres: ${c.genres.join(", ")}`,
    `- Premise: ${p.profile.premise ?? "(null)"}`,
    `- Story (top 8, endings omitted):`,
    ...topKeys(p.profile, "story", 8, true).map((s) => `  - ${s}`),
    `- Feeling (top 6):`,
    ...topKeys(p.profile, "feeling", 6, false).map((s) => `  - ${s}`),
    `- Band: ${p.profile.form.band} · minutes: ${p.profile.form.minutes_to_finish} · craft: ${p.profile.form.craft.map((x) => x.key).join(", ") || "(none)"}`,
    `- (scalars: ${[...p.profile.story, ...p.profile.feeling].filter((a) => !a.key.includes(".")).map((a) => `${a.key}=${p.profile.vector.story[a.key] ?? p.profile.vector.feeling[a.key]}`).join(", ")})`,
    `- Verdict: [ ] right  [ ] partly  [ ] wrong`,
    `- Notes:`,
    ``,
  );
  void item;
}

// ---------------------------------------------------------------------------
// Markdown + JSON reports
// ---------------------------------------------------------------------------

const pass = (v: boolean | null) => (v === null ? "n/a" : v ? "PASS" : "FAIL");

const md: string[] = [
  `# Canon profiles QA report`,
  ``,
  `- Model: \`${nvidiaModel()}\` · ${PROFILE_VERSION} · prompt \`${promptHashValue}\` · ${today}`,
  ``,
  `## Counts`,
  ``,
  ...categories.map((c) => {
    const total = CANON.filter((x) => x.category === c).length;
    const done = profiled.filter((p) => p.category === c).length;
    const failed = CANON.filter((x) => x.category === c && failedSlugs.includes(x.slug)).length;
    const unreachedN = CANON.filter((x) => x.category === c && unreached.includes(x.slug)).length;
    return `- ${c}: ${done}/${total} profiled · ${failed} failed · ${unreachedN} unreached`;
  }),
  ``,
  `## evaluate()`,
  ``,
  `| metric | value | threshold | pass |`,
  `|---|---|---|---|`,
  ...evaluateRows.map((r) => `| ${r.name} | ${r.value === null ? "null (not measurable here)" : r.value.toFixed(4)} | ${r.threshold} | ${pass(r.pass)} |`),
  ``,
  `## Failure reasons (cache errors)`,
  ``,
  ...(failureReasons.size ? [...failureReasons.entries()].map(([reason, n]) => `- ${n}× ${reason}`) : ["- none"]),
  ``,
  `## Prevalence (top 30 globally)`,
  ``,
  `| key | family | global | movie | tv | anime | book | music | |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...rows.slice(0, 30).map((r: PrevalenceRow) => {
    const flag = r.global > QA_THRESHOLDS.prevalenceFlag ? "REVIEW" : "";
    const share = (c: Category) => {
      const v = r.byCategory[c];
      return v === undefined ? "-" : v.toFixed(2);
    };
    return `| ${r.key} | ${r.family} | ${r.global.toFixed(2)} | ${share("movie")} | ${share("tv")} | ${share("anime")} | ${share("book")} | ${share("music")} | ${flag} |`;
  }),
  ``,
  `- Singleton keys (exactly 1 profile): ${singletonKeys}`,
  ``,
  `## Category artifacts (report-only)`,
  ``,
  ...(artifacts.length ? artifacts.map((r) => `- ${r.key}: ${Object.entries(r.byCategory).filter(([, v]) => v > 0).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(", ")}`) : ["- none"]),
  ``,
  `## Group fill (cap = SPEC §1.2)`,
  ``,
  `| group | mean count | cap | share at cap |`,
  `|---|---|---|---|`,
  ...fill.map((f) => `| ${f.group} | ${f.meanCount.toFixed(2)} | ${f.cap} | ${(f.shareAtCap * 100).toFixed(0)}% |`),
  ``,
  `## Mean confidence`,
  ``,
  `- story: ${meanConfidence("story").toFixed(3)} · feeling: ${meanConfidence("feeling").toFixed(3)}`,
  ``,
  `## Premise`,
  ``,
  `- null premise: ${premiseNull}/${profiled.length}`,
  `- praise-guard drops: ${praiseDrops}`,
  ``,
  `## Music (profiled, never matched — DECISIONS #50)`,
  ``,
  `- ${musicItems.length} profiles`,
  ...(musicRows.slice(0, 10).map((r) => `- ${r.key}: ${r.global.toFixed(2)}`)),
  ``,
  `Note: canon profiles come from title, creator, year and genres only (canon has no overviews), so they rely on the model's knowledge of the work.`,
  ``,
  `Caps used by the schema: ${JSON.stringify(PROFILE_CAPS)}`,
  ``,
];

mkdirSync("docs/qa", { recursive: true });
writeFileSync("docs/qa/canon-profiles-report.md", md.join("\n"));
writeFileSync("docs/qa/canon-review.md", reviewLines.join("\n"));

const json = {
  generated_at: new Date().toISOString(),
  model: nvidiaModel(),
  profile_version: PROFILE_VERSION,
  prompt_hash: promptHashValue,
  counts: Object.fromEntries(categories.map((c) => {
    const total = CANON.filter((x) => x.category === c).length;
    const done = profiled.filter((p) => p.category === c).length;
    return [c, { profiled: done, failed: CANON.filter((x) => x.category === c && failedSlugs.includes(x.slug)).length, unreached: CANON.filter((x) => x.category === c && unreached.includes(x.slug)).length, total }];
  })),
  firstPassStrict,
  committedStrict: profiled.length ? 1 : 0,
  evaluate: evaluateRows,
  failure_reasons: Object.fromEntries(failureReasons),
  prevalence_top30: rows.slice(0, 30),
  review_flags: reviewKeys.map((r) => r.key),
  category_artifacts: artifacts,
  singleton_keys: singletonKeys,
  group_fill: fill,
  mean_confidence: { story: meanConfidence("story"), feeling: meanConfidence("feeling") },
  premise: { null_share: profiled.length ? premiseNull / profiled.length : 0, praise_drops: praiseDrops },
  music: { count: musicItems.length, top: musicRows.slice(0, 10) },
  failed_slugs: failedSlugs,
  unreached_slugs: unreached,
  review_sample: sample.map((p) => p.slug),
};
writeFileSync("docs/qa/canon-profiles-report.json", `${JSON.stringify(json, null, 2)}\n`);
console.log(`wrote docs/qa/canon-profiles-report.md/.json and docs/qa/canon-review.md (${profiled.length} profiles, sample ${sample.length})`);
