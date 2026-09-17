import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Extraction } from "@/lib/types";
import { extractionToVector } from "@/lib/taste/vector";
import { AFTERTASTES, REGISTERS, TEXTURES, THEMES, TONES, VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import { mockExtractor, mockQuote } from "./mock-extractor";
export { mockExtract, mockExtractor } from "./mock-extractor";

export type { ExtractionInput, ExtractionResult, Extractor } from "./mock-extractor";
import type { Extractor } from "./mock-extractor";
import { nvidiaExtractor } from "./nvidia";

/* ------------------------------------------------------------------------ */
/* Claude: structured output against the same vocabulary.                    */
/* ------------------------------------------------------------------------ */

const tag = (values: readonly string[]) => z.object({ key: z.enum(values as [string, ...string[]]), weight: z.number().min(0).max(1) });
const ExtractionSchema = z.object({
  tones: z.array(tag(TONES)).max(4),
  registers: z.array(tag(REGISTERS)).max(3),
  textures: z.array(tag(TEXTURES)).max(3),
  aftertastes: z.array(tag(AFTERTASTES)).max(3),
  themes: z.array(tag(THEMES)).max(4),
  intensity: z.number().min(0).max(1),
  ache: z.number().min(0).max(1),
  pace: z.number().min(0).max(1),
  summary: z.string().max(60),
  quote: z.string().max(160).nullable(),
});

const SYSTEM = `You turn one person's private words about something they watched, read, or listened to into a fixed emotional vocabulary that is shared across films, TV, anime, books, and songs. The vocabulary is deliberately category-agnostic: a folk song and a war novel can share "grief", "spare", "lingering".

Rules:
- Only use the enumerated keys. Weights are 0..1 and should reflect how strongly the person's words carry that attribute, not how strongly the work is generally known for it.
- If the person wrote nothing, infer gently from the tapped reactions and keep weights low (≤0.5).
- "intensity" is how forceful the experience was; "ache" is longing/melancholy; "pace" is 0 for slow-burn, 1 for brisk.
- "summary" is a short noun phrase in plain English that captures the feeling in their words (e.g. "quiet devastation", "warm, ramshackle joy"). No title, no adjectives about quality.
- "quote" must be a verbatim excerpt (≤160 chars) of the person's own words that best carries the feeling, or null if they wrote nothing.
- Never judge the work. Never mention other people's opinions.`;

export function claudeExtractor(client: Anthropic, model: string): Extractor {
  return {
    name: "claude",
    async extract(input) {
      const dims = Object.entries(input.dimensions ?? {}).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " "));
      const user = [
        `Category: ${input.category}`,
        `Title: ${input.title}${input.subtitle ? ` — ${input.subtitle}` : ""}`,
        `Tapped reactions: ${dims.length ? dims.join(", ") : "none"}`,
        `Their words:`,
        input.note?.trim() ? input.note.trim() : "(nothing written)",
      ].join("\n");
      const response = await client.messages.parse({
        model,
        max_tokens: 2048,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(ExtractionSchema), effort: "low" },
      });
      if (response.stop_reason === "refusal") throw new Error(`Extraction refused: ${response.stop_details?.explanation ?? "unknown"}`);
      const parsed = response.parsed_output;
      if (!parsed) throw new Error("Extraction returned no structured output");
      // Guard the quote: it must really be the user's words.
      const quote = parsed.quote && input.note && input.note.includes(parsed.quote.replace(/…$/, "")) ? parsed.quote : (parsed.quote && input.note ? mockQuote(input.note) : null);
      const extraction: Extraction = { ...parsed, quote };
      return { extraction, vector: extractionToVector(extraction), extractor: "claude", vocabulary_version: VOCABULARY_VERSION };
    },
  };
}

/* ------------------------------------------------------------------------ */

export function aiEnabled(): boolean {
  return aiProvider() !== "mock";
}
export function aiProvider(): "claude" | "nvidia" | "mock" {
  if (process.env.AI_PROVIDER === "nvidia") return process.env.NVIDIA_API_KEY ? "nvidia" : "mock";
  if (process.env.AI_PROVIDER === "claude") return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
  if (process.env.AI_PROVIDER === "mock") return "mock";
  // Backwards-compatible auto-selection for deployments without AI_PROVIDER.
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.NVIDIA_API_KEY) return "nvidia";
  return "mock";
}
export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5";
}

let cached: Extractor | null = null;
/** Picks Claude when a key is configured; otherwise the deterministic mock. Same interface either way. */
export function getExtractor(): Extractor {
  if (cached) return cached;
  cached = aiProvider() === "nvidia" ? nvidiaExtractor() : aiProvider() === "claude" ? claudeExtractor(new Anthropic(), anthropicModel()) : mockExtractor;
  return cached;
}
