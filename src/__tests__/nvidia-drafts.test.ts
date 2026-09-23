import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NVIDIA_JSON_MODE, nvidiaProfileDraft, nvidiaReadingDraft } from "@/lib/ai/nvidia";
import { buildItemProfile } from "@/lib/ai/profile-contract";
import { finalizeReading, READING_SYSTEM_PROMPT } from "@/lib/ai/reading";
import { PROFILE_SYSTEM_PROMPT } from "@/lib/ai/profile-contract";
import type { MediaItem } from "@/lib/types";

const item: MediaItem = {
  id: "canon:movie-test", category: "movie", title: "Test Film", subtitle: null, source: "canon",
  external_id: "movie-test", image_url: null, release_year: 2020,
  creators: [{ name: "A Director", role: "director" }], genre_tags: ["drama"],
  metadata: { runtime_minutes: 100 }, feel_prior: null,
};

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); vi.stubEnv("NVIDIA_API_KEY", "test-key"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

const respond = (content: string) => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content } }],
  }), { status: 200 }));
};

const readingDraft = {
  story: { theme: [{ key: "grief", weight: 0.8 }], arc: [], conflict: [], cast: [], bond: [], world: [], setting: [], frame: [], structure: [], momentum: [], stakes: [], ending: [] },
  feeling: { tone: [{ key: "bleak", weight: 0.7 }], register: [], texture: [], aftertaste: [] },
  scalars: { intensity: 0.7 },
  absent: [],
  didnt_work: { keys: [], phrases: [] },
  valued: [],
  summary: "grief and bleakness",
  quote: null,
};

const profileDraft = {
  premise: "A test film.",
  story: {
    theme: [{ key: "grief", weight: 0.8, confidence: 0.9 }], arc: [], conflict: [], cast: [], bond: [],
    world: [], setting: [], frame: [], structure: [], momentum: [],
    stakes: [{ key: "personal", weight: 0.8, confidence: 0.9 }],
    ending: [{ key: "open", weight: 0.8, confidence: 0.9 }],
  },
  feeling: { tone: [], register: [], texture: [], aftertaste: [] },
  scalars: {
    intensity: { value: 0.7, confidence: 1 }, ache: { value: 0.5, confidence: 1 }, pace: { value: 0.5, confidence: 1 },
    "moral-complexity": { value: 0.5, confidence: 1 }, complexity: { value: 0.5, confidence: 1 },
  },
  craft: [],
};

const requestBody = (): Record<string, unknown> => JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

describe("nvidia draft helpers with constrained output (amendment 1, test J)", () => {
  it("nvidiaReadingDraft + finalizeReading yields the same finalized reading as before", async () => {
    respond(`\`\`\`json\n${JSON.stringify(readingDraft)}\n\`\`\``);
    const { reading: draft, raw } = await nvidiaReadingDraft({
      note: "It was a bleak film about grief.", dimensions: {}, category: "movie", title: "Test Film", subtitle: null,
    });
    const finalized = finalizeReading(draft, "It was a bleak film about grief.");
    expect(finalized.story.theme).toEqual([{ key: "grief", weight: 0.8 }]);
    expect(raw).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("nvidiaProfileDraft feeds buildItemProfile exactly as nvidiaProfiler did", async () => {
    respond(JSON.stringify(profileDraft));
    const { draft: parsed } = await nvidiaProfileDraft(item);
    const profile = buildItemProfile(item, parsed, { attributeSource: "ai", completeness: "strict" });
    expect(profile.story.map((a) => a.key)).toContain("theme.grief");
    expect(profile.form.minutes_to_finish).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("every request body carries the schema in the selected mode (amendment acceptance)", async () => {
    respond(JSON.stringify(profileDraft));
    await nvidiaProfileDraft(item);
    const body = requestBody();
    if (NVIDIA_JSON_MODE === "response_format") {
      const rf = body.response_format as { type: string; json_schema?: { name?: string; schema?: unknown; strict?: boolean } };
      expect(rf.type).toBe("json_schema");
      expect(rf.json_schema?.strict).toBe(true);
      expect(rf.json_schema?.schema).toBeTruthy();
    } else if (NVIDIA_JSON_MODE === "guided_json") {
      expect((body.nvext as { guided_json?: unknown }).guided_json).toBeTruthy();
    } else {
      expect(body.response_format).toBeUndefined();
      expect(body.nvext).toBeUndefined();
      expect(body.chat_template_kwargs).toBeUndefined();
    }
  });

  it("malformed drafts are rejected, never repaired: a `value`-dialect tag still fails", async () => {
    const bad = structuredClone(profileDraft) as unknown as Record<string, unknown>;
    (bad.story as Record<string, unknown>).theme = [{ value: "grief", weight: 0.8, confidence: 0.9 }];
    respond(JSON.stringify(bad));
    await expect(nvidiaProfileDraft(item)).rejects.toThrow();
  });
});

describe("prompt shape sections (amendment §B)", () => {
  it("both prompts state the tag object shape, arrays-always, and no-prose rules", () => {
    for (const prompt of [PROFILE_SYSTEM_PROMPT, READING_SYSTEM_PROMPT]) {
      expect(prompt).toContain('"key"');
      expect(prompt).toContain("no prose");
      expect(prompt).toContain("[]");
    }
    // The worked example uses listed keys only.
    expect(PROFILE_SYSTEM_PROMPT).toContain('"theme"');
    expect(READING_SYSTEM_PROMPT).toContain('"theme"');
  });
});
