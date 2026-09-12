import { describe, expect, it } from "vitest";
import { mockExtract } from "@/lib/ai/mock-extractor";
import { isKnownKey, VOCABULARY_VERSION } from "@/lib/taste/vocabulary";

describe("mock extraction", () => {
  it("reads grief and quiet devastation from plain words", () => {
    const r = mockExtract({ note: "Quiet devastation. A father and daughter on a cheap holiday and the memory of it years later. I sat in the dark for a long time after.", dimensions: { moved_me: true }, category: "movie", title: "Aftersun" });
    expect(r.vocabulary_version).toBe(VOCABULARY_VERSION);
    expect(r.vector["theme.memory"]).toBeGreaterThan(0.6);
    expect(r.vector["register.quiet"]).toBeGreaterThan(0.6);
    expect(r.vector["aftertaste.devastating"]).toBeGreaterThan(0.6);
    expect(r.extraction.quote).toMatch(/Quiet devastation/);
    for (const k of Object.keys(r.vector)) expect(isKnownKey(k)).toBe(true);
  });
  it("is deterministic", () => {
    const input = { note: "Warm, silly, generous. Comfort food.", dimensions: { comforted_me: true }, category: "tv" as const, title: "X" };
    expect(mockExtract(input)).toEqual(mockExtract(input));
  });
  it("uses dimensions gently when there are no words", () => {
    const r = mockExtract({ note: null, dimensions: { comforted_me: true }, category: "book", title: "X" });
    expect(r.vector["aftertaste.comforting"]).toBeGreaterThan(0.5);
    expect(r.extraction.quote).toBeNull();
  });
});
