import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ImpressionSnapshot } from "@/lib/taste/snapshot";
import { checkAiExplanation } from "@/lib/taste/explain";
import { describeKey } from "@/lib/taste/vocabulary";
import { aiProvider, anthropicModel } from "./extractor";
import { nvidiaExplainer } from "./nvidia";

export interface Explainer {
  readonly name: "mock" | "claude" | "nvidia";
  /** One string per snapshot, or null to keep the deterministic sentence. Never throws (§8, handoff §2.4). */
  explain(snapshots: ImpressionSnapshot[]): Promise<Array<string | null>>;
}

/** Null means "keep the deterministic sentence" — the one already stored in the snapshot. */
export const mockExplainer: Explainer = {
  name: "mock",
  async explain(snapshots) {
    return snapshots.map(() => null);
  },
};

/**
 * Exactly what the model sees for one item (§9.1 `explain` + route/band). Nothing else
 * goes to the model: no scores, no weights, no features, no raw notes beyond `quote`
 * and `valued`, no keys, no ids.
 */
export function explainerPayload(snapshot: ImpressionSnapshot) {
  const anchor = snapshot.anchor;
  return {
    index: snapshot.position - 1,
    title: snapshot.item.title,
    category: snapshot.item.category,
    creator: snapshot.item.creator,
    route: snapshot.route,
    band: snapshot.rerank.band,
    anchor: anchor && { title: anchor.title, category: anchor.category, ownWords: anchor.ownWords },
    shared: snapshot.shared.map((s) => describeKey(s.key)),
    summary: snapshot.explain.summary,
    quote: snapshot.explain.quote,
    valued: snapshot.explain.valued,
    creator_they_return_to: snapshot.explain.creator,
    phase_label: snapshot.explain.phase_label,
    fits: snapshot.explain.fits,
    draft: snapshot.explanation,
  };
}

/** One prompt for both providers (handoff §2.4): the six routes plus the legacy evidence rules. */
export const EXPLAINER_PROMPT = `You write one or two short sentences explaining why a recommendation connects to something a person already loves, using only the facts you are given. The person is private and allergic to hype.

Rules:
- Each item names the "route" that actually produced it. Your first clause must match that route and nothing else:
  · "story" — ground it in the anchor: the thing they loved and the shared attributes. Say plainly "This connects to ...".
  · "feeling" — ground it in the anchor and the feeling they described. Say plainly "This connects to ...".
  · "form" — it matches the length they tend to love; use "fits" when present.
  · "creator" — lead with the person in "creator_they_return_to".
  · "phase" — lead with "phase_label": it fits what they are into right now.
  · "backlog" — it is already on their own list; say so, and use "fits" when present.
- When there is no "anchor", or "anchor"."ownWords" is false, the person has written nothing about the thing you are comparing to. Say it "sits close to what you tend to love", never "you loved" or "you wrote".
- Never invent plot, awards, reviews, popularity, or facts about the recommended work. You know nothing about it beyond its title, creator and the attributes listed.
- Never compare to other people. Never say "popular", "critics", "fans", "everyone", "acclaimed", "classic", "rated".
- Never mention a number, score, rating or percentage.
- Warm, specific, unshowy. British-neutral English. No exclamation marks. No emojis.
- Quote the person's own words when a quote is provided, using curly quotes.
- "draft" is the safe sentence to improve, never to contradict.`;

const Out = z.object({ explanations: z.array(z.object({ index: z.number().int(), text: z.string().max(320) })) });

/** Per-item guard: anything §8.6 forbids falls back to the deterministic sentence for that item only. */
export const guarded = (text: string | undefined, s: ImpressionSnapshot): string | null => {
  const t = text?.trim();
  return t && checkAiExplanation(t, s) ? t : null;
};

/**
 * Align the model's entries with the snapshots by the `index` each entry names, never by
 * array position (review P1): a model may return valid entries out of order, and reading
 * them by position would attach an explanation to the wrong card. Every index 0..count-1
 * must appear exactly once — a wrong length, a duplicated index or an out-of-range index
 * (which is also a missing one) returns null, and the caller keeps the deterministic
 * sentences for the whole batch rather than risk misattribution.
 */
export function explanationsByIndex(entries: Array<{ index: number; text: string }>, count: number): Array<string | undefined> | null {
  if (entries.length !== count) return null;
  const texts: Array<string | undefined> = new Array(count);
  for (const e of entries) {
    if (!Number.isInteger(e.index) || e.index < 0 || e.index >= count || texts[e.index] !== undefined) return null;
    texts[e.index] = e.text;
  }
  return texts;
}

export function claudeExplainer(client: Anthropic, model: string): Explainer {
  return {
    name: "claude",
    async explain(snapshots) {
      if (snapshots.length === 0) return [];
      try {
        const payload = snapshots.map(explainerPayload);
        const response = await client.messages.parse({
          model,
          max_tokens: 4096,
          system: [{ type: "text", text: EXPLAINER_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: `Shortlist (JSON):\n${JSON.stringify(payload, null, 2)}` }],
          output_config: { format: zodOutputFormat(Out), effort: "low" },
        });
        const parsed = response.stop_reason === "refusal" ? null : response.parsed_output;
        const byIndex = parsed ? explanationsByIndex(parsed.explanations, snapshots.length) : null;
        if (!byIndex) return snapshots.map(() => null);
        return snapshots.map((s, i) => guarded(byIndex[i], s));
      } catch (err) {
        console.error("[explainer] falling back to deterministic explanations:", err);
        return snapshots.map(() => null);
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
