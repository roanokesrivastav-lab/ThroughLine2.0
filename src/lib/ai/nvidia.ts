import "server-only";
import { z } from "zod";
import type { MediaItem, Reading } from "@/lib/types";
import { readingToVector } from "@/lib/taste/vector";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import type { ExtractionInput, ExtractionResult, Extractor } from "./mock-extractor";
import type { Explainer } from "./explainer";
import { emptyReading, finalizeReading, READING_SYSTEM_PROMPT, ReadingSchema } from "./reading";
import { buildItemProfile, PROFILE_SYSTEM_PROMPT, ProfileDraftSchema, profilerInput, type ProfileDraft } from "./profile-contract";

const endpoint = () => process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
/** Default chosen by testing real notes: gpt-oss-20b gave contradictory readings of the same note; Nemotron 3 Super was consistent. */
export const nvidiaModel = () => process.env.NVIDIA_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b";

/** Reasoning models (gpt-oss, Nemotron 3) think before answering; the thinking counts against max_tokens. */
const supportsReasoningEffort = (m: string) => /gpt-oss/i.test(m);

/**
 * How decoding is constrained (Amendment 1 §A, Session 4 §2.7). The probe
 * (scripts/probe-nvidia.mts) picked the mode: response_format json_schema with thinking
 * off is the proven default (docs/qa/nvidia-constrained-probe.md), so a deployed server
 * without these env vars uses it. The env vars remain overrides: NVIDIA_JSON_MODE=none
 * restores the historical freeform call.
 *
 * Read per call, not at import time: the probe switches the env between variants, and a
 * module constant froze the first value for every call (the first probe run measured
 * nothing because of exactly this bug).
 */
export type NvidiaJsonMode = "response_format" | "guided_json" | "none";
export const jsonMode = (): NvidiaJsonMode =>
  (process.env.NVIDIA_JSON_MODE?.trim() || "response_format") as NvidiaJsonMode;

/** Thinking is off for the profile/reading calls unless NVIDIA_DISABLE_THINKING=0 (Amendment 1 probe; Session 4 §2.7). Read per call. */
const thinkingDisabled = () => process.env.NVIDIA_DISABLE_THINKING?.trim() !== "0";

async function complete(
  system: string,
  user: string,
  maxTokens: number,
  format?: { name: string; schema: z.ZodType },
): Promise<string> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key) throw new Error("NVIDIA_API_KEY is not configured");
  const m = nvidiaModel();
  // Only strip maxItems/minItems if the endpoint rejects them — the local parse still
  // enforces every cap, so removing them from the sent copy loses no validation.
  let sentSchema: Record<string, unknown> | undefined;
  const mode = jsonMode();
  if (format && mode !== "none") {
    sentSchema = z.toJSONSchema(format.schema, { io: "output" }) as Record<string, unknown>;
  }
  const constrainedBody = (): Record<string, unknown> => {
    if (!format || mode === "none" || !sentSchema) return {};
    if (mode === "response_format") {
      return { response_format: { type: "json_schema", json_schema: { name: format.name, schema: sentSchema, strict: true } } };
    }
    return { nvext: { guided_json: sentSchema } };
  };
  const thinkingBody = (): Record<string, unknown> => {
    if (!format || !thinkingDisabled()) return {};
    return { chat_template_kwargs: { enable_thinking: false } };
  };
  const attempt = async (): Promise<Response> =>
    fetch(`${endpoint()}/chat/completions`, {
      method: "POST",
      // Never let a stalled provider hang extraction; the cron retries failures later.
      signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: m, messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens, temperature: 0.1, stream: false,
        ...(supportsReasoningEffort(m) ? { reasoning_effort: "low" } : {}),
        ...constrainedBody(),
        ...thinkingBody(),
      }),
    });
  let response = await attempt();
  // If the endpoint rejects the schema over unsupported keywords, retry once without the
  // caps in the sent copy (Amendment 1 §A); local parsing still enforces them.
  if (!response.ok && format && mode !== "none" && /schema|keyword|json/i.test(await response.clone().text())) {
    sentSchema = stripArrayCaps(sentSchema as Record<string, unknown>);
    response = await attempt();
  }
  if (!response.ok) throw new Error(`NVIDIA API ${response.status} (${m}): ${(await response.text()).slice(0, 300)}`);
  const body = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }> };
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new Error(choice?.finish_reason === "length"
      ? `NVIDIA model ${m} used its whole token allowance before answering (likely thinking); raise max_tokens or pick a non-reasoning model`
      : `NVIDIA model ${m} returned no text (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
  }
  return content;
}

function json<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Some open models add a sentence before or after the object; keep only the outermost braces.
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  return schema.parse(JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned));
}

const stripArrayCaps = (schema: Record<string, unknown>): Record<string, unknown> => {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = { ...(node as Record<string, unknown>) };
      delete out.maxItems;
      delete out.minItems;
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
};

/**
 * The parsed ReadingSchema output for one note, before finalizeReading (Session 3 §2.1 of
 * the handoff: repeat-eval needs the raw draft to measure verbatim-guard drops).
 * Behaviour is identical to what nvidiaExtractor did inline.
 */
export async function nvidiaReadingDraft(input: ExtractionInput): Promise<{ reading: Reading; raw: string }> {
  const note = input.note?.trim() ?? "";
  const user = [`Category: ${input.category}`, `Title: ${input.title}${input.subtitle ? ` — ${input.subtitle}` : ""}`, `Their words:`, note].join("\n");
  const raw = await complete(READING_SYSTEM_PROMPT, user, 8192, { name: "reading_draft", schema: ReadingSchema });
  return { reading: json(raw, ReadingSchema), raw };
}

export function nvidiaExtractor(): Extractor {
  return { name: "nvidia", async extract(input: ExtractionInput): Promise<ExtractionResult> {
    if (!input.note?.trim()) {
      const extraction = emptyReading();
      return { extraction, vector: readingToVector(extraction), extractor: "nvidia", vocabulary_version: VOCABULARY_VERSION };
    }
    const { reading: parsed } = await nvidiaReadingDraft(input);
    const extraction: Reading = finalizeReading(parsed, input.note);
    return { extraction, vector: readingToVector(extraction), extractor: "nvidia", vocabulary_version: VOCABULARY_VERSION };
  } };
}

/**
 * The parsed ProfileDraft for one item, before buildItemProfile (Session 3: the scripts
 * cache drafts and rebuild profiles through the current builder). Amendment 1: decoding
 * is constrained by the schema itself and the parse goes through the shared json() helper;
 * malformed drafts are rejected, never repaired (DECISIONS #65, #77).
 */
export async function nvidiaProfileDraft(item: MediaItem): Promise<{ draft: ProfileDraft }> {
  const raw = await complete(PROFILE_SYSTEM_PROMPT, profilerInput(item), 8192, {
    name: "profile_draft",
    schema: ProfileDraftSchema,
  });
  return { draft: json(raw, ProfileDraftSchema) };
}

export function nvidiaProfiler(): import("./profiler").ItemProfiler {
  return {
    name: "nvidia",
    async profile(item) {
      const { draft } = await nvidiaProfileDraft(item);
      // Let NVIDIA and validation errors propagate: the queue marks the row failed.
      return buildItemProfile(item, draft, { attributeSource: "ai", completeness: "strict" });
    },
  };
}

export function nvidiaExplainer(): Explainer {
  const schema = z.object({ explanations: z.array(z.object({ index: z.number().int(), text: z.string().max(320) })) });
  return { name: "nvidia", async explain(recs) {
    if (!recs.length) return recs;
    const system = "Return only valid JSON in the form {\"explanations\":[{\"index\":0,\"text\":\"...\"}]}. Write one or two short, warm, specific sentences per recommendation using only the supplied evidence. Never invent facts, popularity, reviews, or plot. Do not alter quoted user words.";
    const payload = recs.map((r, index) => ({ index, title: r.item.title, category: r.item.category, creator: r.item.subtitle, route: r.route, matched_tags: r.breakdown.matchedTags.slice(0, 3).map((m) => m.tag), bridge: r.bridge ? { title: r.bridge.title, summary: r.bridge.summary, quote: r.bridge.quote } : null }));
    const parsed = json(await complete(system, JSON.stringify(payload), 8192), schema);
    const byIndex = new Map(parsed.explanations.map((item) => [item.index, item.text.trim()]));
    return recs.map((r, index) => ({ ...r, explanation: byIndex.get(index) || r.explanation }));
  } };
}
