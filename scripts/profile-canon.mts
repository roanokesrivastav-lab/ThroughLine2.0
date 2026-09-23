// Session 3 §2.4: write real NVIDIA ItemProfiles for every canon title into
// src/lib/catalog/canon-profiles.ts, with a hard session-wide call budget and a
// resumable cache. Run via npm run profile:canon.
//
// Flags: --dry-run | --only a,b | --max-calls N | --no-resume | --write-only
import { writeFileSync } from "node:fs";
import {
  BudgetExceededError,
  CACHE_DIR,
  CallLedger,
  readCache,
  withRetries,
  promptHash,
  writeCache,
  type CacheEntry,
} from "@/lib/dev/profiling-run";
import { renderCanonProfilesModule } from "@/lib/dev/canon-profiles-render";
import { buildItemProfile, PROFILE_SYSTEM_PROMPT, ProfileDraftSchema, profilerInput, type ProfileDraft } from "@/lib/ai/profile-contract";
import { nvidiaProfileDraft, nvidiaModel } from "@/lib/ai/nvidia";
import { aiProvider } from "@/lib/ai/extractor";
import { CANON } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import type { MediaItem } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = flag("--dry-run");
const writeOnly = flag("--write-only");
const noResume = flag("--no-resume");
const only = flagValue("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const maxCalls = flagValue("--max-calls") ? Number(flagValue("--max-calls")) : undefined;

const provider = aiProvider();
if (provider !== "nvidia") {
  console.error(`Refusing to run: aiProvider() is "${provider}", this script only runs against NVIDIA.`);
  process.exit(1);
}
const model = nvidiaModel();
const promptHashValue = promptHash(PROFILE_SYSTEM_PROMPT);

console.log(`provider: ${provider}  model: ${model}  prompt: ${promptHashValue}  (key never printed)`);

const toMediaItem = (c: (typeof CANON)[number]): MediaItem =>
  // feel_prior is nulled so it cannot reach the model even by accident;
  // profilerInput already omits it.
  ({ ...canonToResult(c), id: `canon:${c.slug}`, feel_prior: null });

if (dryRun) {
  for (const c of CANON.slice(0, 3)) {
    const item = toMediaItem(c);
    console.log(`\n--- ${c.slug} ---`);
    console.log(profilerInput(item));
  }
  process.exit(0);
}

const ledger = new CallLedger(undefined, maxCalls ?? 500);
console.log(`budget: ${ledger.used}/${ledger.max} calls used before this run`);

const items = CANON.filter((c) => !only || only.includes(c.slug));

if (!writeOnly) {
  for (const c of items) {
    const item = toMediaItem(c);
    const cached = noResume
      ? null
      : readCache(CACHE_DIR, c.slug, { provider, model, profileVersion: PROFILE_VERSION, promptHash: promptHashValue });
    if (cached) {
      console.log(`${c.slug} · cached (attempts ${cached.attempts}) · skip`);
      continue;
    }

    // The retry closure stashes the validated draft so the cache can record it without a
    // second model call.
    let draft: ProfileDraft | null = null;
    let attempts = 0;
    let firstAttemptOk = false;
    let error: string | null = null;
    try {
      const run = await withRetries(
        async () => {
          const { draft: parsed } = await nvidiaProfileDraft(item);
          // Strict validation inside the retried call: a ProfileValidationError counts as
          // a failed attempt and is retried like any other error.
          const profile = buildItemProfile(item, parsed, { attributeSource: "ai", completeness: "strict" });
          draft = parsed;
          return profile;
        },
        { retries: 2, backoffMs: [5000, 15000], ledger, meta: { script: "profile-canon", id: c.slug } },
      );
      attempts = run.attempts;
      firstAttemptOk = run.attempts === 1;
    } catch (e) {
      error = (e as Error).message?.slice(0, 300);
      attempts = (e as { attempts?: number }).attempts ?? 0;
      if (e instanceof BudgetExceededError) {
        console.error(`Budget stopped the run: ${e.message}`);
        writeModule(ledger, "BUDGET");
        process.exit(2);
      }
    }
    const entry: CacheEntry = {
      slug: c.slug, provider, model, profile_version: PROFILE_VERSION, prompt_hash: promptHashValue,
      attempts, first_attempt_ok: firstAttemptOk, draft, error, finished_at: new Date().toISOString(),
    };
    // Written after every item, success or failure, so a crash loses nothing.
    writeCache(CACHE_DIR, entry);
    console.log(`${c.slug} · attempts ${attempts} · ${draft ? "ok" : `FAILED (${error ?? "unknown"})`}`);
  }
}

writeModule(ledger, writeOnly ? "WRITE-ONLY" : "DONE");

/** Rebuild the generated module from every reusable cache draft, through the CURRENT builder. */
function writeModule(ledgerRef: CallLedger, status: string): void {
  const entries: Array<{ slug: string; profile: ReturnType<typeof buildItemProfile> }> = [];
  const failed: string[] = [];
  for (const c of CANON) {
    const cached = readCache(CACHE_DIR, c.slug, { provider, model, profileVersion: PROFILE_VERSION, promptHash: promptHashValue });
    if (!cached?.draft) {
      failed.push(c.slug);
      continue;
    }
    const item = toMediaItem(c);
    try {
      const parsed = ProfileDraftSchema.parse(cached.draft);
      entries.push({ slug: c.slug, profile: buildItemProfile(item, parsed, { attributeSource: "ai", completeness: "strict" }) });
    } catch (e) {
      console.error(`${c.slug}: cached draft failed strict validation: ${(e as Error).message?.slice(0, 200)}`);
      failed.push(c.slug);
    }
  }
  const moduleSource = renderCanonProfilesModule(entries, {
    provider, model, profileVersion: PROFILE_VERSION, vocabularyVersion: VOCABULARY_VERSION,
    promptHash: promptHashValue, generatedAt: new Date().toISOString(), total: entries.length, failed,
  });
  writeFileSync("src/lib/catalog/canon-profiles.ts", moduleSource);
  console.log(`[${status}] wrote src/lib/catalog/canon-profiles.ts: ${entries.length} profiles, ${failed.length} failed/unreached, ${ledgerRef.used}/${ledgerRef.max} calls used`);
}
