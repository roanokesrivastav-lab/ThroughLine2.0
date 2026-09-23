import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { nvidiaProfiler } from "@/lib/ai/nvidia";
import { claudeProfiler, profilerFor } from "@/lib/ai/item-profiler";
import { mockProfile, mockProfiler } from "@/lib/ai/profiler";
import { ProfileValidationError } from "@/lib/ai/profile-contract";
import { PROFILE_SYSTEM_PROMPT } from "@/lib/ai/profile-contract";
import type { MediaItem } from "@/lib/types";

const baseItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: "tmdb:27205",
  category: "movie",
  title: "Inception",
  subtitle: null,
  source: "tmdb",
  external_id: "27205",
  image_url: null,
  release_year: 2010,
  creators: [{ name: "Christopher Nolan", role: "Director" }],
  genre_tags: ["action", "sci-fi"],
  metadata: { runtime_minutes: 148, overview: "A story of grief and memory, a lonely heist inside dreams." },
  feel_prior: null,
  ...overrides,
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const nvidiaBody = (content: string) => ({
  choices: [{ finish_reason: "stop", message: { content } }],
});

describe("mock profiler (DECISIONS #67)", () => {
  it("N: is deterministic, passes lenient validation, and is the named mock ItemProfiler", async () => {
    const a = await mockProfiler.profile(baseItem());
    const b = await mockProfiler.profile(baseItem());
    expect(a).toEqual(b);
    expect(mockProfiler.name).toBe("mock");
    expect(mockProfile(baseItem()).profile_version).toBe("p1");
  });

  it("O: reads the lexicon over the overview; negated keys are dropped completely", () => {
    const profile = mockProfile(baseItem());
    const keys = [...profile.story, ...profile.feeling].map((a) => a.key);
    expect(keys).toContain("theme.grief");
    expect(keys).toContain("theme.memory");
    expect(keys).toContain("theme.loneliness");

    const negated = mockProfile(baseItem({ metadata: { overview: "not a lonely film" } }));
    const negatedKeys = [...negated.story, ...negated.feeling].map((a) => a.key);
    expect(negatedKeys).not.toContain("theme.loneliness");
  });

  it("P: ignores the overview of a manual item, leaving only genre frames", () => {
    const item = baseItem({ source: "manual", genre_tags: ["sci-fi"] });
    const profile = mockProfile(item);
    const nonFrame = [...profile.story, ...profile.feeling].filter((a) => !a.key.startsWith("frame."));
    expect(nonFrame).toEqual([]);
    expect(profile.story.map((a) => a.key)).toContain("frame.sci-fi");
  });

  it("O2: negation drops the key even when the same word appears positively elsewhere", () => {
    const item = baseItem({
      metadata: { overview: "A lonely hero. Not a lonely world." },
      genre_tags: [],
    });
    const keys = [...mockProfile(item).story, ...mockProfile(item).feeling].map((a) => a.key);
    expect(keys).not.toContain("theme.loneliness");
  });
});

describe("nvidia profiler", () => {
  const draft = {
    premise: "A thief steals secrets from dreams.",
    story: {
      theme: [{ key: "grief", weight: 0.8, confidence: 0.9 }],
      arc: [], conflict: [], cast: [], bond: [], world: [], setting: [], frame: [],
      structure: [], momentum: [], stakes: [{ key: "personal", weight: 0.8, confidence: 0.9 }],
      ending: [{ key: "ambiguous", weight: 0.8, confidence: 0.9 }],
    },
    feeling: { tone: [], register: [], texture: [], aftertaste: [] },
    scalars: {
      intensity: { value: 0.7, confidence: 1 },
      ache: { value: 0.5, confidence: 1 },
      pace: { value: 0.6, confidence: 1 },
      "moral-complexity": { value: 0.6, confidence: 1 },
      complexity: { value: 0.7, confidence: 1 },
    },
    craft: [{ key: "visual.stylised", weight: 0.8, confidence: 0.8 }],
  };

  it("Q: parses a fenced JSON draft from surrounding prose into a profile; one POST; no feel_prior in the body", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    fetchMock.mockResolvedValueOnce(okResponse(nvidiaBody(`Sure! Here is the profile:\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`\nHope that helps.`)));
    const profile = await nvidiaProfiler().profile(baseItem());
    expect(profile.premise).toBe("A thief steals secrets from dreams.");
    expect(profile.story.map((a) => a.key)).toContain("theme.grief");
    expect(profile.form.craft.map((c) => c.key)).toEqual(["visual.stylised"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/completions");
    expect(String(init.body)).not.toContain("feel_prior");
    expect(String(init.body)).toContain("Inception");
  });

  it("R: invalid JSON throws; missing key throws a clear error; a draft missing ending fails validation", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    fetchMock.mockResolvedValueOnce(okResponse(nvidiaBody("not json at all")));
    await expect(nvidiaProfiler().profile(baseItem())).rejects.toThrow();

    vi.stubEnv("NVIDIA_API_KEY", "");
    fetchMock.mockClear();
    await expect(nvidiaProfiler().profile(baseItem())).rejects.toThrow("NVIDIA_API_KEY is not configured");

    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    const noEnding = structuredClone(draft);
    noEnding.story.ending = [];
    fetchMock.mockResolvedValueOnce(okResponse(nvidiaBody(JSON.stringify(noEnding))));
    await expect(nvidiaProfiler().profile(baseItem())).rejects.toThrow(ProfileValidationError);
  });
});

describe("claude profiler", () => {
  const draft = {
    premise: "A thief steals secrets from dreams.",
    story: {
      theme: [{ key: "grief", weight: 0.8, confidence: 0.9 }],
      arc: [], conflict: [], cast: [], bond: [], world: [], setting: [], frame: [],
      structure: [], momentum: [], stakes: [{ key: "personal", weight: 0.8, confidence: 0.9 }],
      ending: [{ key: "ambiguous", weight: 0.8, confidence: 0.9 }],
    },
    feeling: { tone: [], register: [], texture: [], aftertaste: [] },
    scalars: {
      intensity: { value: 0.7, confidence: 1 },
      ache: { value: 0.5, confidence: 1 },
      pace: { value: 0.6, confidence: 1 },
      "moral-complexity": { value: 0.6, confidence: 1 },
      complexity: { value: 0.7, confidence: 1 },
    },
    craft: [],
  };

  const fakeClient = (response: unknown) =>
    ({ messages: { parse: vi.fn().mockResolvedValue(response) } }) as unknown as Parameters<typeof claudeProfiler>[0];

  it("S: a parsed_output draft becomes a profile; refusal and missing output throw", async () => {
    const good = await claudeProfiler(fakeClient({ parsed_output: draft, stop_reason: "end_turn" }), "claude-opus-5")
      .profile(baseItem());
    expect(good.premise).toBe("A thief steals secrets from dreams.");
    expect(good.story.map((a) => a.key)).toContain("theme.grief");

    await expect(
      claudeProfiler(fakeClient({ parsed_output: draft, stop_reason: "refusal" }), "claude-opus-5").profile(baseItem()),
    ).rejects.toThrow();
    await expect(
      claudeProfiler(fakeClient({ parsed_output: null, stop_reason: "end_turn" }), "claude-opus-5").profile(baseItem()),
    ).rejects.toThrow();
  });

  it("T: profilerFor returns the right names without any network call", () => {
    expect(profilerFor("mock").name).toBe("mock");
    expect(profilerFor("nvidia").name).toBe("nvidia");
    expect(profilerFor("claude").name).toBe("claude");
    expect(PROFILE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});
