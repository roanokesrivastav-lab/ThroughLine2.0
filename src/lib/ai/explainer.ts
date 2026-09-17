import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Recommendation } from "@/lib/types";
import { fallbackExplanation } from "@/lib/taste/recommend";
import { describeKey } from "@/lib/taste/vocabulary";
import { aiProvider, anthropicModel } from "./extractor";
import { nvidiaExplainer } from "./nvidia";

export interface Explainer {
  readonly name: "mock" | "claude" | "nvidia";
  /** Adds a plain-language explanation to each recommendation. Never invents metadata; only uses what it is handed. */
  explain(recs: Recommendation[], portraitLine: string): Promise<Recommendation[]>;
}

export const mockExplainer: Explainer = {
  name: "mock",
  async explain(recs) {
    return recs.map((r) => ({ ...r, explanation: r.explanation || fallbackExplanation(r) }));
  },
};

const Out = z.object({ explanations: z.array(z.object({ index: z.number().int(), text: z.string().max(320) })) });

const SYSTEM = `You write one or two short sentences explaining why a recommendation connects to something a person already loves, using only the facts you are given. The person is private and allergic to hype.

Rules:
- Each item names the "route" that actually produced it. Your first clause must match that route and nothing else:
  · "feeling" — ground it in the bridge: the thing they loved, the feeling they described, the shared attributes. Say plainly "This connects to …".
  · "tag_overlap" — ground it in "matched_tags", the kinds of thing they keep returning to. Do not claim they described a feeling.
  · "creator" — lead with the person in "creator_they_return_to" and how many of their things are already in the library.
  · "backlog" — it is already on their own list; say so, and use "fits" if it is present.
- When "evidence" is "catalogue_prior" the person has written nothing about the thing you are comparing to. Say it "sits close to what you tend to love", never "you loved" or "you wrote".
- Never invent plot, awards, reviews, popularity, or facts about the recommended work. You know nothing about it beyond its title, creator and the attributes listed.
- Never compare to other people. Never say "critics", "fans", "everyone", "acclaimed", "classic".
- Warm, specific, unshowy. British-neutral English. No exclamation marks. No emojis.
- Quote the person's own words when a quote is provided, using curly quotes.`;

export function claudeExplainer(client: Anthropic, model: string): Explainer {
  return {
    name: "claude",
    async explain(recs, portraitLine) {
      if (recs.length === 0) return recs;
      // The evidence the scorer actually used, so the sentence can never claim a
      // reason the arithmetic did not support.
      const payload = recs.map((r, index) => ({
        index,
        title: r.item.title,
        category: r.item.category,
        creator: r.item.subtitle,
        route: r.route,
        matched_tags: r.breakdown.matchedTags.slice(0, 3).map((m) => m.tag),
        shared_attributes: (r.bridge?.shared ?? []).slice(0, 4).map((s) => describeKey(s.key)),
        bridge: r.bridge ? { title: r.bridge.title, category: r.bridge.category, their_summary: r.bridge.summary, their_words: r.bridge.quote } : null,
        creator_they_return_to: r.breakdown.creator ? { name: r.breakdown.creator.name, count: r.breakdown.creator.entryIds.length } : null,
        /** Whether the feeling layer had anything to read, or this is a catalogue prior. */
        evidence: r.bridge?.quote ? "their_words" : "catalogue_prior",
        fits: r.fits,
      }));
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 4096,
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: `Their taste right now: ${portraitLine}\n\nShortlist (JSON):\n${JSON.stringify(payload, null, 2)}` }],
          output_config: { format: zodOutputFormat(Out), effort: "low" },
        });
        const parsed = response.stop_reason === "refusal" ? null : response.parsed_output;
        const map = new Map(parsed?.explanations.map((e) => [e.index, e.text]) ?? []);
        return recs.map((r, i) => ({ ...r, explanation: map.get(i)?.trim() || fallbackExplanation(r) }));
      } catch (err) {
        console.error("[explainer] falling back to deterministic explanations:", err);
        return mockExplainer.explain(recs, portraitLine);
      }
    },
  };
}

let cached: Explainer | null = null;
export function getExplainer(): Explainer {
  if (cached) return cached;
  cached = aiProvider() === "nvidia" ? nvidiaExplainer() : aiProvider() === "claude" ? claudeExplainer(new Anthropic(), anthropicModel()) : mockExplainer;
  return cached;
}
