// Amendment 1 §C probe: find the constrained-decoding variant that makes Nemotron output
// schema-valid JSON for BOTH the profile path (movie-spirited-away) and the reading path
// (the movie-in-the-mood-for-love demo seed). Writes docs/qa/nvidia-constrained-probe.md.
//
// The sweep runs ONE variant per invocation (`--variant N`) and resumes from
// scripts/out/probe-state.json: this session's tool harness reaps background processes and
// kills foreground commands on a timeout, which silently destroyed whole-run attempts (the
// first probe measured nothing for a different reason — the adapter read the mode/thinking
// env vars once at import). Per-attempt ledger lines make every call durable either way.
//
// Run: node --conditions=react-server --env-file=.env.local --import tsx scripts/probe-nvidia.mts --variant 1
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { CallLedger, type LedgerMeta } from "@/lib/dev/profiling-run";
import { nvidiaModel, nvidiaProfileDraft, nvidiaReadingDraft } from "@/lib/ai/nvidia";
import { ProfileDraftSchema } from "@/lib/ai/profile-contract";
import { ReadingSchema } from "@/lib/ai/reading";
import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { SEEDS } from "@/lib/server/demo-seeds";
import type { MediaItem } from "@/lib/types";

const ledger = new CallLedger("scripts/out/calls.jsonl");
const STATE_PATH = "scripts/out/probe-state.json";
const PACING_MS = 5_000;
const RETRY_503_WAIT_MS = 30_000;
// The adapter aborts its own fetch at 120 s; this only covers a wedged abort.
const WATCHDOG_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const variantIndex = Number(process.argv[process.argv.indexOf("--variant") + 1] ?? "");
if (!Number.isInteger(variantIndex) || variantIndex < 1 || variantIndex > 4) {
  console.error("usage: --variant N (1..4) — one variant per invocation");
  process.exit(2);
}

type Mode = "response_format" | "guided_json";
type Variant = { name: string; mode: Mode; thinking: boolean };

const VARIANTS: Variant[] = [
  { name: "response_format json_schema (thinking on)", mode: "response_format", thinking: false },
  { name: "guided_json (thinking on)", mode: "guided_json", thinking: false },
  { name: "response_format json_schema (thinking off)", mode: "response_format", thinking: true },
  { name: "guided_json (thinking off)", mode: "guided_json", thinking: true },
];
const variant = VARIANTS[variantIndex - 1]!;

const canonItem = CANON_BY_SLUG.get("movie-spirited-away");
if (!canonItem) throw new Error("canon item movie-spirited-away not found");
const profileItem: MediaItem = { ...canonToResult(canonItem), id: `canon:${canonItem.slug}`, feel_prior: null };

const seed = SEEDS.find((s) => s.slug === "movie-in-the-mood-for-love");
if (!seed) throw new Error("movie-in-the-mood-for-love seed not found");
const readingInput = { category: "movie" as const, title: "In the Mood for Love", subtitle: null, note: seed.note ?? null, dimensions: {} };

type Outcome = {
  ok: boolean;
  /** true = the endpoint accepted the request and returned content (validation may still fail). */
  accepted: boolean | null;
  status?: number;
  ms: number;
  error?: string;
  retried503?: boolean;
};

const classify = (error: unknown, ms: number): Outcome => {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = /NVIDIA API (\d+)/.exec(message);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  // 4xx means the request itself was rejected (e.g. unsupported schema keywords); 5xx is a
  // server-side failure; a Zod/JSON parse error means the request was accepted and answered.
  const accepted = status === undefined ? true : status < 500 ? false : null;
  return { ok: false, accepted, status, ms, error: message.slice(0, 220) };
};

const profileThunk = async (): Promise<void> => {
  const r = await nvidiaProfileDraft(profileItem);
  ProfileDraftSchema.parse(r.draft); // strict parse check independent of the adapter
};
const readingThunk = async (): Promise<void> => {
  const r = await nvidiaReadingDraft(readingInput);
  ReadingSchema.parse(r.reading);
};

const attempt = async (kind: "profile" | "reading"): Promise<Outcome> => {
  const meta: LedgerMeta = { script: "probe-nvidia", id: `${variant.mode}:${variant.thinking ? "nothink" : "think"}:${kind}` };
  const start = Date.now();
  const watchdog = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`probe watchdog: attempt exceeded ${WATCHDOG_MS / 1000} s`)), WATCHDOG_MS),
  );
  const prevMode = process.env.NVIDIA_JSON_MODE;
  const prevThink = process.env.NVIDIA_DISABLE_THINKING;
  try {
    // The adapter reads these per call, so switching them here selects the variant.
    process.env.NVIDIA_JSON_MODE = variant.mode;
    if (variant.thinking) process.env.NVIDIA_DISABLE_THINKING = "1";
    else delete process.env.NVIDIA_DISABLE_THINKING;

    // Each attempt writes its own ledger line (take → thunk → record), so a timeout or
    // kill mid-run can never lose the record of calls already made.
    const thunk = kind === "profile" ? profileThunk : readingThunk;
    ledger.take();
    console.log(`  ${kind}: calling (${variant.mode}, thinking ${variant.thinking ? "off" : "on"})…`);
    try {
      await Promise.race([thunk(), watchdog]);
      ledger.record({ ...meta, attempt: 1, ok: true, ms: Date.now() - start });
      return { ok: true, accepted: true, ms: Date.now() - start };
    } catch (error) {
      ledger.record({ ...meta, attempt: 1, ok: false, ms: Date.now() - start, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "BudgetExceededError") throw error;
    return classify(error, Date.now() - start);
  } finally {
    if (prevMode === undefined) delete process.env.NVIDIA_JSON_MODE;
    else process.env.NVIDIA_JSON_MODE = prevMode;
    if (prevThink === undefined) delete process.env.NVIDIA_DISABLE_THINKING;
    else process.env.NVIDIA_DISABLE_THINKING = prevThink;
  }
};

/** One call, plus a single 503 retry (a 503 says nothing about the variant). */
const runOne = async (kind: "profile" | "reading"): Promise<Outcome> => {
  await sleep(PACING_MS);
  let result = await attempt(kind);
  if (!result.ok && result.status === 503) {
    console.log(`  ${kind}: 503, retrying once after ${RETRY_503_WAIT_MS / 1000}s`);
    await sleep(RETRY_503_WAIT_MS);
    result = { ...(await attempt(kind)), retried503: true };
  }
  return result;
};

type State = { variants: Record<string, { profile: Outcome; reading: Outcome }>; winner: string | null };

const loadState = (): State => {
  if (!existsSync(STATE_PATH)) return { variants: {}, winner: null };
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
};
const saveState = (state: State) => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

const label = (x: Outcome): string =>
  x.ok ? "✅" : x.status === undefined ? "❌ parse/validation" : `❌ HTTP ${x.status}${x.retried503 ? " (after 503 retry)" : ""}`;
const acceptedLabel = (x: Outcome): string =>
  x.ok || x.accepted === true ? "yes" : x.accepted === false ? "no" : "n/a (server error)";

const state = loadState();

// Ordering + stop rule: run variants in order; stop at the first variant where BOTH validate.
const priorRow = state.variants[VARIANTS[variantIndex - 2]?.name ?? ""] ?? (variantIndex === 1 ? { profile: { ok: true } as Outcome, reading: { ok: true } as Outcome } : null);
if (!priorRow) {
  console.error(`variant ${variantIndex} blocked: run variant ${variantIndex - 1} first`);
  process.exit(2);
}
if (state.winner) {
  console.log(`already have a winner (${state.winner}); nothing to do`);
  process.exit(0);
}

console.log(`probe: variant ${variantIndex}/4 — ledger ${ledger.used}/500, model ${nvidiaModel()}`);
console.log(`variant: ${variant.name}`);
const profile = await runOne("profile");
console.log(`  profile: ${label(profile)}${profile.error ? ` — ${profile.error.slice(0, 140)}` : ""}`);
const reading = await runOne("reading");
console.log(`  reading: ${label(reading)}${reading.error ? ` — ${reading.error.slice(0, 140)}` : ""}`);

state.variants[variant.name] = { profile, reading };
if (profile.ok && reading.ok) state.winner = variant.name;
saveState(state);

const rowsDone = VARIANTS.filter((v) => state.variants[v.name]);
const retries = Object.values(state.variants).reduce((n, r) => n + (r.profile.retried503 ? 1 : 0) + (r.reading.retried503 ? 1 : 0), 0);
const contentCalls = Object.keys(state.variants).length * 2;

const cell = (x: Outcome) =>
  x.ok ? `✅ (${x.ms} ms)` : `❌ HTTP ${x.status ?? "—"}${x.error ? ` — ${x.error.replace(/\s+/g, " ").slice(0, 90)}` : ""}`;
const lines: string[] = [
  "# NVIDIA constrained-output probe (Amendment 1 §C)",
  "",
  `Date: ${new Date().toISOString().slice(0, 10)} · model: ${nvidiaModel()} · session calls used (ledger total): ${ledger.used}`,
  "",
  "Fixed inputs: profile = movie-spirited-away (canon catalogue data only); reading = the movie-in-the-mood-for-love demo seed note.",
  "One attempt per call, no retries except a single 503 retry (a 503 says nothing about the variant); 5 s pacing between calls.",
  "A variant stops the sweep only when BOTH paths validate strictly.",
  "",
  "Re-probe note: the first probe (same date, 8 calls) measured nothing — the adapter read the mode/thinking env vars once at import, so every call ran unconstrained, and the §B worked examples showed scalars inside story/feeling. Both fixed before this run; calls count against the same ledger. Whole-run invocations were also destroyed twice by the session harness (background reaping / command timeout, zero calls lost thanks to per-attempt ledger lines), so the sweep now runs one variant per invocation.",
  "",
  "| Variant | Request accepted | HTTP status | Profile validates | Reading validates | Latency (profile / reading) |",
  "|---|---|---|---|---|---|",
  ...rowsDone.map((v) => {
    const r = state.variants[v.name]!;
    return `| ${v.name} | profile: ${acceptedLabel(r.profile)}, reading: ${acceptedLabel(r.reading)} | ${r.profile.status ?? "—"} / ${r.reading.status ?? "—"} | ${cell(r.profile)} | ${cell(r.reading)} | ${r.profile.ms} / ${r.reading.ms} ms |`;
  }),
  "",
  state.winner
    ? `**Winner: \`${VARIANTS.find((v) => v.name === state.winner)!.mode}\` with thinking ${VARIANTS.find((v) => v.name === state.winner)!.thinking ? "disabled" : "on"}.** Set \`NVIDIA_JSON_MODE=${VARIANTS.find((v) => v.name === state.winner)!.mode}\`${VARIANTS.find((v) => v.name === state.winner)!.thinking ? " and `NVIDIA_DISABLE_THINKING=1`" : ""} in \`.env.local\`.`
    : `**No variant validated so far.** ${rowsDone.length < VARIANTS.length ? `${VARIANTS.length - rowsDone.length} variant(s) left.` : "NVIDIA_JSON_MODE stays `none`; keep the §B prompt changes and STOP (founder decides on switching models)."}`,
  "",
  `Probe calls: ${contentCalls} content calls${retries ? ` + ${retries} 503 ${retries === 1 ? "retry" : "retries"}` : ""} (amendment cap 8 content calls) · every call went through CallLedger (scripts/out/calls.jsonl) and counts against the 500-call cap.`,
  "",
];

writeFileSync("docs/qa/nvidia-constrained-probe.md", lines.join("\n"));
console.log(state.winner ? `WINNER: ${state.winner}` : `no winner yet (${rowsDone.length}/4 variants done)`);
console.log("wrote docs/qa/nvidia-constrained-probe.md and scripts/out/probe-state.json");
