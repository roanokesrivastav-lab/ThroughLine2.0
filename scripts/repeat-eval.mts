// Session 3 §2.6: repeatability eval. LIVE and budgeted through the same ledger as
// profile-canon. Run via npm run qa:repeat.
import { mkdirSync, writeFileSync } from "node:fs";
import { BudgetExceededError, CACHE_DIR, CallLedger, readCache, promptHash, withRetries } from "@/lib/dev/profiling-run";
import { buildItemProfile, PROFILE_SYSTEM_PROMPT, ProfileDraftSchema } from "@/lib/ai/profile-contract";
import { nvidiaProfileDraft, nvidiaReadingDraft, nvidiaModel } from "@/lib/ai/nvidia";
import { finalizeReading } from "@/lib/ai/reading";
import { pairwise, scalarMae, setJaccard, topKOverlap, weightedJaccard } from "@/lib/taste/qa";
import { readingToVector } from "@/lib/taste/vector";
import { SCALARS } from "@/lib/taste/vocabulary";
import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { SEEDS } from "@/lib/server/demo-seeds";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import type { MediaItem } from "@/lib/types";

const today = new Date().toISOString().slice(0, 10);
const ledger = new CallLedger();
console.log(`provider: nvidia  model: ${nvidiaModel()}  budget: ${ledger.used}/${ledger.max} used`);

const toMediaItem = (slug: string): MediaItem => {
  const c = CANON_BY_SLUG.get(slug)!;
  return { ...canonToResult(c), id: `canon:${slug}`, feel_prior: null };
};

// Review sample = first 4 canon items of each category in CANON order (same as the report).
const categories = ["movie", "tv", "anime", "book", "music"] as const;
const sampleSlugs: string[] = [];
for (const category of categories) {
  for (const c of CANON_BY_SLUG.values()) {
    if (c.category === category && sampleSlugs.filter((s) => CANON_BY_SLUG.get(s)!.category === category).length < 4) {
      sampleSlugs.push(c.slug);
    }
  }
}

let partial = false;

// ---------------------------------------------------------------------------
// A. Profiles: run 1 = committed cached draft (free), runs 2 and 3 = fresh, no retries.
// ---------------------------------------------------------------------------

type ProfileRuns = { slug: string; vectors: Array<{ story: Record<string, number>; feeling: Record<string, number> }>; scalars: Array<Record<string, number>>; valid: boolean[] };

const profileRows: ProfileRuns[] = [];
for (const slug of sampleSlugs) {
  const item = toMediaItem(slug);
  const vectors: ProfileRuns["vectors"] = [];
  const scalars: ProfileRuns["scalars"] = [];
  const valid: boolean[] = [];

  const add = (draft: unknown) => {
    try {
      const parsed = ProfileDraftSchema.parse(draft);
      const profile = buildItemProfile(item, parsed, { attributeSource: "ai", completeness: "strict" });
      vectors.push(profile.vector);
      scalars.push(Object.fromEntries([...profile.story, ...profile.feeling].filter((a) => !a.key.includes(".")).map((a) => [a.key, profile.vector.story[a.key] ?? profile.vector.feeling[a.key]])));
      valid.push(true);
    } catch {
      valid.push(false);
    }
  };

  // Run 1: the committed draft from the cache — free.
  const cached = readCache(CACHE_DIR, slug, {
    provider: "nvidia", model: nvidiaModel(), profileVersion: PROFILE_VERSION, promptHash: promptHash(PROFILE_SYSTEM_PROMPT),
  });
  if (cached?.draft) add(cached.draft);
  else { valid.push(false); vectors.push({ story: {}, feeling: {} }); scalars.push({}); }

  // Runs 2 and 3: fresh calls, retries: 0 → a failure is a validity failure.
  for (let run = 0; run < 2; run++) {
    try {
      const result = await withRetries(() => nvidiaProfileDraft(item), {
        retries: 0, backoffMs: [], ledger, meta: { script: "repeat-eval", id: `${slug}:r${run + 2}` },
      });
      add(result.value.draft);
    } catch (e) {
      if (e instanceof BudgetExceededError) { partial = true; break; }
      valid.push(false);
      vectors.push({ story: {}, feeling: {} });
      scalars.push({});
    }
  }
  if (partial) break;

  profileRows.push({ slug, vectors, scalars, valid });
  console.log(`profiles ${slug}: valid ${valid.filter(Boolean).length}/3`);
}

const mean = (list: number[]) => (list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0);

const storyJ: number[] = [];
const feelingJ: number[] = [];
const storyTop: number[] = [];
const feelingTop: number[] = [];
const scalarDiffs: number[] = [];
for (const row of profileRows) {
  for (const [a, b] of pairwise([0, 1, 2])) {
    if (!row.vectors[a] || !row.vectors[b]) continue;
    const sj = weightedJaccard(row.vectors[a].story, row.vectors[b].story);
    const fj = weightedJaccard(row.vectors[a].feeling, row.vectors[b].feeling);
    if (sj !== null) storyJ.push(sj);
    if (fj !== null) feelingJ.push(fj);
    const st = topKOverlap(row.vectors[a].story, row.vectors[b].story);
    const ft = topKOverlap(row.vectors[a].feeling, row.vectors[b].feeling);
    if (st !== null) storyTop.push(st);
    if (ft !== null) feelingTop.push(ft);
    const mae = scalarMae(row.scalars[a], row.scalars[b], SCALARS);
    if (mae !== null) scalarDiffs.push(mae);
  }
}

// ---------------------------------------------------------------------------
// B. Readings: 35 demo seed notes × 3 runs, no retries.
// ---------------------------------------------------------------------------

type ReadingRuns = { slug: string; pairs: number; excluded: number; jStory: number[]; jFeeling: number[]; mae: number[]; absentJ: number[]; didntJ: number[]; guardDrops: number; guardTotal: number; schemaFailures: number };

const readingRows: ReadingRuns[] = [];
const usableSeeds = SEEDS.filter((s) => s.note);

for (const seed of usableSeeds) {
  const item = toMediaItem(seed.slug);
  const runs: Array<{ story: Record<string, number>; feeling: Record<string, number> } | null> = [];
  const absentSets: string[][] = [];
  const didntSets: string[][] = [];
  const scalarMaps: Array<Record<string, number>> = [];
  let guardDrops = 0;
  let guardTotal = 0;
  let schemaFailures = 0;

  for (let run = 0; run < 3; run++) {
    try {
      const input = { note: seed.note ?? "", dimensions: {}, category: item.category, title: item.title, subtitle: item.subtitle };
      const { reading: draft, raw } = await nvidiaReadingDraft(input);
      const finalized = finalizeReading(draft, seed.note ?? null);
      const vec = readingToVector(finalized);
      runs.push(vec);
      absentSets.push(finalized.absent);
      didntSets.push(finalized.didnt_work.keys.map((k) => k.key));
      scalarMaps.push(Object.fromEntries(Object.entries(finalized.scalars).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v as number])));

      // Verbatim guard drops: items present in the raw draft but removed by finalizeReading.
      const rawDraft = draft as unknown as { valued?: string[]; didnt_work?: { phrases?: string[] }; quote?: string | null };
      const countDrops = (rawList: string[] | undefined, kept: string[]) => {
        const rawItems = rawList ?? [];
        guardTotal += rawItems.length;
        guardDrops += rawItems.filter((x) => !kept.includes(x)).length;
      };
      const rawTextOk = (s: string) => (seed.note ?? "").includes(s);
      countDrops(rawDraft.valued, finalized.valued.filter(rawTextOk));
      countDrops(rawDraft.didnt_work?.phrases, finalized.didnt_work.phrases.filter(rawTextOk));
      if (rawDraft.quote) { guardTotal++; if (!rawTextOk(rawDraft.quote) || finalized.quote !== rawDraft.quote) guardDrops++; }
      void raw;
    } catch (e) {
      if (e instanceof BudgetExceededError) { partial = true; break; }
      schemaFailures++;
      runs.push(null);
      absentSets.push([]);
      didntSets.push([]);
      scalarMaps.push({});
    }
  }

  const jStory: number[] = [];
  const jFeeling: number[] = [];
  const mae: number[] = [];
  const aJ: number[] = [];
  const dJ: number[] = [];
  let excluded = 0;
  for (const [a, b] of pairwise([0, 1, 2])) {
    const va = runs[a];
    const vb = runs[b];
    if (!va || !vb) continue;
    const sj = weightedJaccard(va.story, vb.story);
    const fj = weightedJaccard(va.feeling, vb.feeling);
    if (sj === null && fj === null) excluded++;
    if (sj !== null) jStory.push(sj);
    if (fj !== null) jFeeling.push(fj);
    const m = scalarMae(scalarMaps[a], scalarMaps[b], SCALARS);
    if (m !== null) mae.push(m);
    const aj = setJaccard(absentSets[a], absentSets[b]);
    if (aj !== null) aJ.push(aj);
    const dj = setJaccard(didntSets[a], didntSets[b]);
    if (dj !== null) dJ.push(dj);
  }
  readingRows.push({
    slug: seed.slug, pairs: jStory.length + jFeeling.length, excluded,
    jStory, jFeeling, mae, absentJ: aJ, didntJ: dJ, guardDrops, guardTotal, schemaFailures,
  });
  console.log(`reading ${seed.slug}: ${runs.filter(Boolean).length}/3 runs parsed`);
  if (partial) break;
}

// Latency p50/p95 and timeout count from the ledger file.
const latency = () => {
  const fs = await0();
  return fs;
};
function await0(): { p50: number; p95: number; timeouts: number } {
  // Synchronous read of the JSONL ledger (node:fs was imported at top for write; read via createRequire to stay simple).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
  const file = "scripts/out/calls.jsonl";
  if (!existsSync(file)) return { p50: 0, p95: 0, timeouts: 0 };
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { ok: boolean; ms: number; error?: string });
  const ms = lines.map((l) => l.ms).sort((a, b) => a - b);
  const pick = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : 0);
  return { p50: pick(0.5), p95: pick(0.95), timeouts: lines.filter((l) => !l.ok && /timeout|aborted/i.test(l.error ?? "")).length };
}
const lat = latency();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const firstPassStrict = 0; // read from canon-profiles-report.json
const readJsonReport = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
  const file = "docs/qa/canon-profiles-report.json";
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as { firstPassStrict: number; committedStrict: number; prevalence_top30: Array<{ global: number }>; review_flags: string[] };
};
const base = readJsonReport();
const maxPrevalence = base?.prevalence_top30?.length ? Math.max(...base.prevalence_top30.map((r) => r.global)) : 0;

const { evaluate } = await import("@/lib/taste/qa");
const evalRows = evaluate({
  firstPassStrict: base?.firstPassStrict ?? firstPassStrict,
  committedStrict: base?.committedStrict ?? 1,
  agreementStory: storyJ.length ? mean(storyJ) : null,
  agreementFeeling: feelingJ.length ? mean(feelingJ) : null,
  scalarMae: scalarDiffs.length ? mean(scalarDiffs) : null,
  maxPrevalence,
});

const pass = (v: boolean | null) => (v === null ? "n/a" : v ? "PASS" : "FAIL");

const md: string[] = [
  `# Repeatability report`,
  ``,
  `- Model: \`${nvidiaModel()}\` · ${today}${partial ? " · **PARTIAL** (budget ran out mid-run)" : ""}`,
  `- Calls used: ${ledger.used}/${ledger.max}`,
  `- Latency p50 ${lat.p50} ms · p95 ${lat.p95} ms · timeouts ${lat.timeouts}`,
  ``,
  `## evaluate() PASS/FAIL (profiles; readings are diagnostic)`,
  ``,
  `| metric | value | threshold | pass |`,
  `|---|---|---|---|`,
  ...evalRows.map((r) => `| ${r.name} | ${r.value === null ? "null" : r.value.toFixed(4)} | ${r.threshold} | ${pass(r.pass)} |`),
  ``,
  `## A. Profile repeatability (${profileRows.length} items × 3 runs)`,
  ``,
  `- strict validity per run: ${profileRows.map((r) => `${r.slug}:${r.valid.filter(Boolean).length}`).join(", ")}`,
  `- mean pairwise weightedJaccard — story: ${storyJ.length ? mean(storyJ).toFixed(3) : "null"} · feeling: ${feelingJ.length ? mean(feelingJ).toFixed(3) : "null"}`,
  `- mean topKOverlap(5) — story: ${storyTop.length ? mean(storyTop).toFixed(3) : "null"} · feeling: ${feelingTop.length ? mean(feelingTop).toFixed(3) : "null"}`,
  `- mean scalarMae (5 scalars): ${scalarDiffs.length ? mean(scalarDiffs).toFixed(3) : "null"}`,
  ``,
  `## B. Reading repeatability (${readingRows.length} notes × 3 runs, diagnostic only)`,
  ``,
  `- mean weightedJaccard — story: ${mean(readingRows.flatMap((r) => r.jStory)).toFixed(3)} · feeling: ${mean(readingRows.flatMap((r) => r.jFeeling)).toFixed(3)}`,
  `- pairs where both sides empty (excluded): ${readingRows.reduce((s, r) => s + r.excluded, 0)}`,
  `- mean scalarMae: ${mean(readingRows.flatMap((r) => r.mae)).toFixed(3)}`,
  `- mean setJaccard — absent: ${mean(readingRows.flatMap((r) => r.absentJ)).toFixed(3)} · didnt_work: ${mean(readingRows.flatMap((r) => r.didntJ)).toFixed(3)}`,
  `- verbatim guard drops: ${readingRows.reduce((s, r) => s + r.guardDrops, 0)}/${readingRows.reduce((s, r) => s + r.guardTotal, 0)}`,
  `- schema-failure rate: ${readingRows.reduce((s, r) => s + r.schemaFailures, 0)}/${readingRows.length * 3}`,
  ``,
  `### Per-item rows (profiles)`,
  ``,
  `| slug | runs valid | story J (pairs) | feeling J | scalar MAE |`,
  `|---|---|---|---|---|`,
  ...profileRows.map((r) => {
    const pairs = pairwise([0, 1, 2]);
    const sjs = pairs.map(([a, b]) => weightedJaccard(r.vectors[a]?.story ?? {}, r.vectors[b]?.story ?? {})).filter((v): v is number => v !== null);
    const fjs = pairs.map(([a, b]) => weightedJaccard(r.vectors[a]?.feeling ?? {}, r.vectors[b]?.feeling ?? {})).filter((v): v is number => v !== null);
    const maes = pairs.map(([a, b]) => scalarMae(r.scalars[a] ?? {}, r.scalars[b] ?? {}, SCALARS)).filter((v): v is number => v !== null);
    return `| ${r.slug} | ${r.valid.filter(Boolean).length}/3 | ${sjs.length ? mean(sjs).toFixed(2) : "-"} | ${fjs.length ? mean(fjs).toFixed(2) : "-"} | ${maes.length ? mean(maes).toFixed(2) : "-"} |`;
  }),
  ``,
];

mkdirSync("docs/qa", { recursive: true });
writeFileSync("docs/qa/repeatability-report.md", md.join("\n"));
const json = {
  generated_at: new Date().toISOString(),
  partial,
  calls_used: ledger.used,
  calls_max: ledger.max,
  latency: lat,
  evaluate: evalRows,
  profiles: {
    per_item: profileRows.map((r) => ({ slug: r.slug, valid: r.valid })),
    mean: {
      agreementStory: storyJ.length ? mean(storyJ) : null,
      agreementFeeling: feelingJ.length ? mean(feelingJ) : null,
      topKStory: storyTop.length ? mean(storyTop) : null,
      topKFeeling: feelingTop.length ? mean(feelingTop) : null,
      scalarMae: scalarDiffs.length ? mean(scalarDiffs) : null,
    },
  },
  readings: {
    per_item: readingRows,
    mean: {
      jStory: mean(readingRows.flatMap((r) => r.jStory)),
      jFeeling: mean(readingRows.flatMap((r) => r.jFeeling)),
      mae: mean(readingRows.flatMap((r) => r.mae)),
      absentJ: mean(readingRows.flatMap((r) => r.absentJ)),
      didntJ: mean(readingRows.flatMap((r) => r.didntJ)),
      guardDropShare: (() => { const t = readingRows.reduce((s, r) => s + r.guardTotal, 0); return t ? readingRows.reduce((s, r) => s + r.guardDrops, 0) / t : 0; })(),
      schemaFailureRate: readingRows.reduce((s, r) => s + r.schemaFailures, 0) / (readingRows.length * 3 || 1),
    },
  },
};
writeFileSync("docs/qa/repeatability-report.json", `${JSON.stringify(json, null, 2)}\n`);
console.log(`wrote docs/qa/repeatability-report.md/.json — ${ledger.used}/${ledger.max} calls used${partial ? " (PARTIAL)" : ""}`);
