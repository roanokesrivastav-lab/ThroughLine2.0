import "server-only";
import { z } from "zod";
import type { Reading } from "@/lib/types";
import { readingToVector } from "@/lib/taste/vector";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import type { ExtractionInput, ExtractionResult, Extractor } from "./mock-extractor";
import type { Explainer } from "./explainer";
import { emptyReading, finalizeReading, READING_SYSTEM_PROMPT, ReadingSchema } from "./reading";

const endpoint = () => process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
/** Default chosen by testing real notes: gpt-oss-20b gave contradictory readings of the same note; Nemotron 3 Super was consistent. */
export const nvidiaModel = () => process.env.NVIDIA_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b";

/** Reasoning models (gpt-oss, Nemotron 3) think before answering; the thinking counts against max_tokens. */
const supportsReasoningEffort = (m: string) => /gpt-oss/i.test(m);

async function complete(system: string, user: string, maxTokens: number): Promise<string> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key) throw new Error("NVIDIA_API_KEY is not configured");
  const m = nvidiaModel();
  const response = await fetch(`${endpoint()}/chat/completions`, {
    method: "POST",
    // Never let a stalled provider hang extraction; the cron retries failures later.
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: m, messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens, temperature: 0.1, stream: false,
      ...(supportsReasoningEffort(m) ? { reasoning_effort: "low" } : {}),
    }),
  });
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

export function nvidiaExtractor(): Extractor {
  return { name: "nvidia", async extract(input: ExtractionInput): Promise<ExtractionResult> {
    if (!input.note?.trim()) {
      const extraction = emptyReading();
      return { extraction, vector: readingToVector(extraction), extractor: "nvidia", vocabulary_version: VOCABULARY_VERSION };
    }
    const user = [`Category: ${input.category}`, `Title: ${input.title}${input.subtitle ? ` — ${input.subtitle}` : ""}`, `Their words:`, input.note.trim()].join("\n");
    const parsed = json(await complete(READING_SYSTEM_PROMPT, user, 8192), ReadingSchema);
    const extraction: Reading = finalizeReading(parsed, input.note);
    return { extraction, vector: readingToVector(extraction), extractor: "nvidia", vocabulary_version: VOCABULARY_VERSION };
  } };
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
