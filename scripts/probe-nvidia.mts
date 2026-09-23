// Amendment 1 §C probe: find the constrained-decoding variant that makes Nemotron output
// schema-valid JSON for BOTH the profile path (movie-spirited-away) and the reading path
// (the movie-in-the-mood-for-love demo seed). At most 8 calls, all through CallLedger, so
// the budget cap covers this script too. Writes docs/qa/nvidia-constrained-probe.md.
//
// Run: node --conditions=react-server --env-file=.env.local --import tsx scripts/probe-nvidia.mts
import { writeFileSync } from "node:fs";
import { CallLedger, withRetries, type LedgerMeta } from "@/lib/dev/profiling-run";
import { nvidiaProfileDraft, nvidiaReadingDraft } from "@/lib/ai/nvidia";
import { ProfileDraftSchema, profilerInput } from "@/lib/ai/profile-contract";
import { ReadingSchema } from "@/lib/ai/reading";
import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { SEEDS } from "@/lib/server/demo-seeds";
import type { MediaItem } from "@/lib/types";

const ledger = new CallLedger("scripts/out/calls.jsonl");

const canonItem = CANON_BY_SLUG.get("movie-spirited-away");
if (!canonItem) throw new Error("canon item movie-spirited-away not found");
const profileItem: MediaItem = { ...canonToResult(canonItem), id: `canon:${canonItem.slug}`, feel_prior: null };

const seed = SEEDS.find((s) => s.slug === "movie-in-the-mood-for-love");
if (!seed) throw new Error("movie-in-the-mood-for-love seed not found");
const readingInput = { category: "movie" as const, title: "In the Mood for Love", subtitle: null, note: seed.note, dimensions: {} };

type Variant = { name: string; mode: "response_format" | "guided_json"; thinking: boolean };

const VARIANTS: Variant[] = [
  { name: "response_format json_schema (thinking on)", mode: "response_format", thinking: false },
  { name: "guided_json (thinking on)", mode: "guided_json", thinking: false },
  { name: "response_format json_schema (thinking off)", mode: "response_format", thinking: true },
  { name: "guided_json (thinking off)", mode: "guided_json", thinking: true },
];

const runOne = async (
  kind: "profile" | "reading",
  variant: Variant,
): Promise<{ ok: boolean; status?: number; ms: number; error?: string }> => {
  const meta: LedgerMeta = { script: "probe-nvidia", id: `${variant.mode}:${variant.thinking ? "nothink" : "think"}:${kind}` };
  const start = Date.now();
  const prevMode = process.env.NVIDIA_JSON_MODE;
  const prevThink = process.env.NVIDIA_DISABLE_THINKING;
  try {
    // The probe sets the env knobs the adapter reads, one call at a time.
    process.env.NVIDIA_JSON_MODE = variant.mode;
    if (variant.thinking) process.env.NVIDIA_DISABLE_THINKING = "1";
    else delete process.env.NVIDIA_DISABLE_THINKING;

    // No retries in the probe: one attempt is what we measure.
    const fn = kind === "profile"
      ? () => nvidiaProfileDraft(profileItem).then((r) => {
          ProfileDraftSchema.parse(r.draft); // strict parse check independent of the adapter
          return r;
        })
      : () => nvidiaReadingDraft(readingInput).then((r) => {
          ReadingSchema.parse(r.reading);
          return r;
        });
    await withRetries(fn, { retries: 0, backoffMs: [], ledger, meta });
    return { ok: true, ms: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /NVIDIA API (\d+)/.exec(message)?.[1];
    return { ok: false, status: status ? Number(status) : undefined, ms: Date.now() - start, error: message.slice(0, 220) };
  } finally {
    if (prevMode === undefined) delete process.env.NVIDIA_JSON_MODE;
    else process.env.NVIDIA_JSON_MODE = prevMode;
    if (prevThink === undefined) delete process.env.NVIDIA_DISABLE_THINKING;
    else process.env.NVIDIA_DISABLE_THINKING = prevThink;
  }
};

const rows: Array<{ variant: string; profile: { ok: boolean; status?: number; ms: number; error?: string }; reading: { ok: boolean; status?: number; ms: number; error?: string } }> = [];
let winner: Variant | null = null;

for (const variant of VARIANTS) {
  if (winner) break;
  console.log(`variant: ${variant.name}`);
  const profile = await runOne("profile", variant);
  console.log(`  profile: ${profile.ok ? "OK" : `FAIL${profile.status ? ` (HTTP ${profile.status})` : ""} ${profile.error ?? ""}`}`);
  const reading = await runOne("reading", variant);
  console.log(`  reading: ${reading.ok ? "OK" : `FAIL${reading.status ? ` (HTTP ${statusLabel(reading.status)})` : ""} ${reading.error ?? ""}`}`);
  rows.push({ variant: variant.name, profile, reading });
  if (profile.ok && reading.ok) winner = variant;
}

function statusLabel(status?: number): string {
  return status === undefined ? "?" : String(status);
}

if (!winner) {
  console.log("NO VARIANT VALIDATED — NVIDIA_JSON_MODE stays \"none\"; STOP per amendment §C.");
} else {
  console.log(`winner: ${winner.name}`);
}

const used = ledger.used;
const lines: string[] = [
  "# NVIDIA constrained-output probe (Amendment 1 §C)",
  "",
  `Date: ${new Date().toISOString().slice(0, 10)} · model: ${process.env.NVIDIA_MODEL ?? "default (Nemotron)"} · session calls used (ledger total): ${used}`,
  "",
  "Fixed inputs: profile = movie-spirited-away (canon catalogue data only); reading = the movie-in-the-mood-for-love demo seed note.",
  "One attempt per call, no retries; a variant stops the sweep only when BOTH paths validate strictly.",
  "",
  "| Variant | Request accepted | HTTP status | Profile validates | Reading validates | Latency (profile / reading) |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => {
    const accepted = (x: { ok: boolean; status?: number; error?: string }) =>
      x.ok ? "yes" : x.status === 400 || x.status === 422 ? "no" : "n/a (server error)";
    const cell = (x: { ok: boolean; status?: number; ms: number; error?: string }) =>
      x.ok ? `✅ (${x.ms} ms)` : `❌ HTTP ${x.status ?? "?"}${x.error ? ` — ${x.error.slice(0, 80)}` : ""}`;
    return `| ${r.variant} | profile: ${accepted(r.profile)}, reading: ${accepted(r.reading)} | ${r.profile.status ?? "—"} / ${r.reading.status ?? "—"} | ${cell(r.profile)} | ${cell(r.reading)} | ${r.profile.ms} / ${r.reading.ms} ms |`;
  }),
  "",
  winner
    ? `**Winner: \`${winner.mode}\` with thinking ${winner.thinking ? "disabled" : "on"}.** Set \`NVIDIA_JSON_MODE=${winner.mode}\`${winner.thinking ? " and `NVIDIA_DISABLE_THINKING=1`" : ""} in \`.env.local\`.`
    : "**No variant validated. NVIDIA_JSON_MODE stays `none`; keep the §B prompt changes and STOP (founder decides on switching models).**",
  "",
  "Every call went through CallLedger (scripts/out/calls.jsonl) and counts against the 500-call cap.",
  "",
];

writeFileSync("docs/qa/nvidia-constrained-probe.md", lines.join("\n"));
console.log("wrote docs/qa/nvidia-constrained-probe.md");
console.log(`profilerInput sent for the profile call (no feel_prior/image expected): ${profilerInput(profileItem).includes("feel_prior") ? "LEAK" : "clean"}`);
