import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Reading } from "@/lib/types";
import { readingToVector } from "@/lib/taste/vector";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import { mockExtractor, mockQuote } from "./mock-extractor";
import { emptyReading, finalizeReading, READING_SYSTEM_PROMPT, ReadingSchema } from "./reading";
export { mockExtract, mockExtractor } from "./mock-extractor";

export type { ExtractionInput, ExtractionResult, Extractor } from "./mock-extractor";
import type { Extractor } from "./mock-extractor";
import { nvidiaExtractor } from "./nvidia";

/* ------------------------------------------------------------------------ */
/* Claude: structured output against the same vocabulary.                    */
/* ------------------------------------------------------------------------ */

export function claudeExtractor(client: Anthropic, model: string): Extractor {
  return {
    name: "claude",
    async extract(input) {
      if (!input.note?.trim()) {
        const extraction = emptyReading();
        return { extraction, vector: readingToVector(extraction), extractor: "claude", vocabulary_version: VOCABULARY_VERSION };
      }
      const user = [
        `Category: ${input.category}`,
        `Title: ${input.title}${input.subtitle ? ` — ${input.subtitle}` : ""}`,
        `Their words:`,
        input.note.trim(),
      ].join("\n");
      const response = await client.messages.parse({
        model,
        max_tokens: 2048,
        system: [{ type: "text", text: READING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(ReadingSchema), effort: "low" },
      });
      if (response.stop_reason === "refusal") throw new Error(`Extraction refused: ${response.stop_details?.explanation ?? "unknown"}`);
      const parsed = response.parsed_output;
      if (!parsed) throw new Error("Extraction returned no structured output");
      const extraction: Reading = finalizeReading(parsed, input.note, mockQuote(input.note));
      return { extraction, vector: readingToVector(extraction), extractor: "claude", vocabulary_version: VOCABULARY_VERSION };
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
