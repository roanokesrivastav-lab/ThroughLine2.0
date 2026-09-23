import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ItemProfile, MediaItem } from "@/lib/types";
import { buildItemProfile, PROFILE_SYSTEM_PROMPT, ProfileDraftSchema, profilerInput } from "./profile-contract";
import type { ItemProfiler } from "./profiler";
import { mockProfiler } from "./profiler";
import { aiProvider, anthropicModel } from "./extractor";
import { nvidiaProfiler } from "./nvidia";

/* ------------------------------------------------------------------------ */
/* Claude: structured output against the same profile contract.              */
/* ------------------------------------------------------------------------ */

export function claudeProfiler(client: Anthropic, model: string): ItemProfiler {
  return {
    name: "claude",
    async profile(item: MediaItem): Promise<ItemProfile> {
      const response = await client.messages.parse({
        model,
        max_tokens: 4096,
        system: [{ type: "text", text: PROFILE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: profilerInput(item) }],
        output_config: { format: zodOutputFormat(ProfileDraftSchema), effort: "low" },
      });
      if (response.stop_reason === "refusal") throw new Error("Profiling refused by the model");
      const draft = response.parsed_output;
      if (!draft) throw new Error("Profiling returned no structured output");
      return buildItemProfile(item, draft, { attributeSource: "ai", completeness: "strict" });
    },
  };
}

/* ------------------------------------------------------------------------ */

let cached: ItemProfiler | null = null;
/** The profiler for one provider name; constructing any of them makes no network call. */
export function profilerFor(provider: "claude" | "nvidia" | "mock"): ItemProfiler {
  if (provider === "nvidia") return nvidiaProfiler();
  if (provider === "claude") return claudeProfiler(new Anthropic(), anthropicModel());
  return mockProfiler;
}

/** Picks the profiler aiProvider() selects (NVIDIA by default per DECISIONS #67), cached like getExtractor. */
export function getProfiler(): ItemProfiler {
  if (cached) return cached;
  cached = profilerFor(aiProvider());
  return cached;
}
