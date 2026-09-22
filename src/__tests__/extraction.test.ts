import { describe, expect, it } from "vitest";
import { mockExtract } from "@/lib/ai/mock-extractor";
import { emptyReading, ReadingSchema } from "@/lib/ai/reading";
import { readingToVector } from "@/lib/taste/vector";
import { asExtractionPayload, asStoredVector } from "@/lib/db/types";
import { familyOf, VOCABULARY_VERSION } from "@/lib/taste/vocabulary";

describe("v2 mock extraction", () => {
  it("separates story and feeling evidence and conforms to the persisted schema", () => {
    const result = mockExtract({
      note: "Quiet devastation. A father and daughter on a cheap holiday and the memory of it years later. I sat in the dark for a long time after.",
      dimensions: { moved_me: true }, category: "movie", title: "Aftersun",
    });
    expect(result.vocabulary_version).toBe(VOCABULARY_VERSION);
    expect(result.vector.story["theme.memory"]).toBeGreaterThan(0.6);
    expect(result.vector.feeling["register.quiet"]).toBeGreaterThan(0.6);
    expect(result.vector.feeling["aftertaste.devastating"]).toBeGreaterThan(0.6);
    expect(result.extraction.quote).toMatch(/Quiet devastation/);
    expect(ReadingSchema.safeParse(result.extraction).success).toBe(true);
    for (const key of Object.keys(result.vector.story)) expect(familyOf(key)).toBe("story");
    for (const key of Object.keys(result.vector.feeling)) expect(familyOf(key)).toBe("feeling");
  });

  it("is deterministic", () => {
    const input = { note: "Warm, silly, generous. Comfort food.", dimensions: { comforted_me: true }, category: "tv" as const, title: "X" };
    expect(mockExtract(input)).toEqual(mockExtract(input));
  });

  it("does not turn taps into words", () => {
    const result = mockExtract({ note: null, dimensions: { comforted_me: true }, category: "book", title: "X" });
    expect(result.vector).toEqual({ story: {}, feeling: {} });
    expect(result.extraction.summary).toBe("");
    expect(result.extraction.quote).toBeNull();
  });

  it("routes a lexicon match negated within three tokens to absent", () => {
    const absent = mockExtract({ note: "It was not quiet at all.", dimensions: {}, category: "movie", title: "X" });
    const present = mockExtract({ note: "It was quiet.", dimensions: {}, category: "movie", title: "X" });
    expect(absent.extraction.absent).toContain("register.quiet");
    expect(absent.vector.feeling["register.quiet"]).toBeUndefined();
    expect(present.vector.feeling["register.quiet"]).toBeGreaterThan(0);
  });

  it("records disliked characteristics separately as preference evidence", () => {
    const result = mockExtract({ note: "I hated how slow it was.", dimensions: {}, category: "book", title: "X" });
    expect(result.extraction.didnt_work.keys).toContainEqual(expect.objectContaining({ key: "pace" }));
    expect(result.extraction.didnt_work.keys.find((tag) => tag.key === "pace")!.weight).toBeGreaterThan(0);
    expect(result.extraction.didnt_work.phrases).toEqual(["I hated how slow it was."]);
  });

  it("keeps valued phrases verbatim", () => {
    const note = "I loved how every character felt like their own main character.";
    const result = mockExtract({ note, dimensions: {}, category: "tv", title: "X" });
    expect(result.extraction.valued).toEqual([note]);
    expect(note.includes(result.extraction.valued[0])).toBe(true);
  });

  it("rejects rather than clamps a negative reading weight", () => {
    const reading = emptyReading();
    reading.feeling.tone = [{ key: "warm", weight: -0.01 }];
    expect(() => readingToVector(reading)).toThrow(/tone\.warm/);
  });

  it("does not reinterpret an unknown vocabulary version as v1", () => {
    expect(asExtractionPayload({ summary: "unknown" }, "v999")).toBeNull();
    expect(asStoredVector({ "tone.warm": 1 }, "v999")).toBeNull();
  });
});
