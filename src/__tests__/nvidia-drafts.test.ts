import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { jsonMode, nvidiaProfileDraft, nvidiaReadingDraft } from "@/lib/ai/nvidia";
import { buildItemProfile, PROFILE_SHAPE_EXAMPLE, PROFILE_SYSTEM_PROMPT } from "@/lib/ai/profile-contract";
import { finalizeReading, READING_SHAPE_EXAMPLE, READING_SYSTEM_PROMPT } from "@/lib/ai/reading";
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

  it("every constrained request body carries the schema in the selected mode (amendment acceptance)", async () => {
    // One case per mode: the mode is read per call from the env, so a single test covers
    // every mode regardless of which one the probe picked.
    const cases: Array<{ mode: "response_format" | "guided_json" | "none" }> = [
      { mode: "response_format" },
      { mode: "guided_json" },
      { mode: "none" },
    ];
    for (const { mode } of cases) {
      fetchMock.mockClear();
      vi.stubEnv("NVIDIA_JSON_MODE", mode);
      respond(JSON.stringify(profileDraft));
      await nvidiaProfileDraft(item);
      const body = requestBody();
      if (mode === "response_format") {
        const rf = body.response_format as { type: string; json_schema?: { name?: string; schema?: unknown; strict?: boolean } };
        expect(rf.type).toBe("json_schema");
        expect(rf.json_schema?.strict).toBe(true);
        expect(rf.json_schema?.schema).toBeTruthy();
      } else if (mode === "guided_json") {
        expect((body.nvext as { guided_json?: unknown }).guided_json).toBeTruthy();
      } else {
        expect(body.response_format).toBeUndefined();
        expect(body.nvext).toBeUndefined();
      }
      // Thinking is off by default (Session 4 §2.7): the toggle rides along on every
      // profile/reading call, whatever the mode. NVIDIA_DISABLE_THINKING=0 is covered below.
      expect((body.chat_template_kwargs as { enable_thinking?: boolean }).enable_thinking).toBe(false);
    }
  });

  it("with NVIDIA_DISABLE_THINKING=1 the body carries chat_template_kwargs.enable_thinking=false", async () => {
    vi.stubEnv("NVIDIA_JSON_MODE", "guided_json");
    vi.stubEnv("NVIDIA_DISABLE_THINKING", "1");
    respond(JSON.stringify(profileDraft));
    await nvidiaProfileDraft(item);
    const body = requestBody();
    expect((body.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking).toBe(false);
    expect((body.nvext as { guided_json?: unknown }).guided_json).toBeTruthy();
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

  it("the worked examples put scalars under the top-level scalars key, matching the schemas", () => {
    // Amendment §B: the example is generated from constants, and the profile schema
    // demands a top-level "scalars" — the first probe run's drafts put moral-complexity
    // inside story (unrecognized_keys) because the example showed it there.
    const profileExample = JSON.parse(PROFILE_SHAPE_EXAMPLE) as {
      scalars?: Record<string, unknown>; story?: Record<string, unknown>;
    };
    expect(Object.keys(profileExample.scalars ?? {})).toEqual(
      expect.arrayContaining(["intensity", "ache", "pace", "moral-complexity", "complexity"]),
    );
    expect("moral-complexity" in (profileExample.story ?? {})).toBe(false);
    const readingExample = JSON.parse(READING_SHAPE_EXAMPLE) as { scalars?: Record<string, unknown> };
    expect(Object.keys(readingExample.scalars ?? {})).toEqual(
      expect.arrayContaining(["intensity", "ache", "pace", "moral-complexity", "complexity"]),
    );
  });

  it("JSON mode defaults to the probe winner (response_format) when unset; env overrides (Session 4 §2.7)", () => {
    expect(jsonMode()).toBe("response_format");
    vi.stubEnv("NVIDIA_JSON_MODE", "none");
    expect(jsonMode()).toBe("none");
  });
});
