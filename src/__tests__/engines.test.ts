import { describe, expect, it } from "vitest";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { findConnections } from "@/lib/taste/connections";
import { detectPhases } from "@/lib/taste/phases";
import { buildPortrait } from "@/lib/taste/portrait";
import { buildEvolution } from "@/lib/taste/evolution";
import { pickResurfaceCandidate } from "@/lib/taste/resurface";
import { similarity } from "@/lib/taste/vector";
import { affinity } from "@/lib/taste/affinity";

const NOW = Date.UTC(2026, 8, 10);
const lib = buildFixtureLibrary(NOW);

describe("vector similarity", () => {
  it("is symmetric, bounded and explains itself", () => {
    const a = { "theme.grief": 0.9, "register.quiet": 0.8, ache: 0.9, pace: 0.2 };
    const b = { "theme.grief": 0.7, "register.quiet": 0.6, "aftertaste.lingering": 0.5, ache: 0.8, pace: 0.3 };
    const s = similarity(a, b);
    expect(s.score).toBeGreaterThan(0.6);
    expect(s.score).toBeLessThanOrEqual(1);
    expect(similarity(b, a).score).toBeCloseTo(s.score, 6);
    expect(s.shared[0].key).toBe("theme.grief");
    expect(similarity(a, { "tone.playful": 0.9, "aftertaste.energized": 0.9, pace: 0.9 }).score).toBeLessThan(0.35);
  });
});

describe("Engine A: connections in feeling", () => {
  const connections = findConnections(lib, { limit: 5 });
  it("finds cross-media connections with explanations", () => {
    expect(connections.length).toBeGreaterThanOrEqual(3);
    for (const c of connections) {
      expect(c.a.item.category).not.toBe(c.b.item.category);
      expect(c.explanation.length).toBeGreaterThan(40);
      expect(c.shared.length).toBeGreaterThan(0);
    }
  });
  it("never uses popularity or scores in the explanation", () => {
    for (const c of connections) expect(c.explanation).not.toMatch(/\b(popular|critics|rated|\d\/10|acclaimed)\b/i);
  });
  it("respects the per-entry cap", () => {
    const counts = new Map<string, number>();
    for (const c of connections) for (const id of [c.a.entry.id, c.b.entry.id]) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });
});

describe("Engine B: phase detection", () => {
  const phases = detectPhases(lib);
  it("detects the album rollup from three songs", () => {
    const album = phases.find((p) => p.kind === "album");
    expect(album?.label).toBe("For Emma, Forever Ago");
    expect(album?.entryIds.length).toBe(3);
  });
  it("detects an Ishiguro run and a cross-media feeling cluster", () => {
    expect(phases.some((p) => p.kind === "creator_run" && p.label.includes("Ishiguro"))).toBe(true);
    const feel = phases.filter((p) => p.kind === "feeling_cluster");
    expect(feel.length).toBeGreaterThan(0);
    expect(feel.some((p) => p.category === null)).toBe(true); // cross-media by nature
  });
  it("gives every phase a confidence in range and a stable fingerprint", () => {
    for (const p of phases) {
      expect(p.confidence).toBeGreaterThanOrEqual(0.3);
      expect(p.confidence).toBeLessThanOrEqual(0.97);
      expect(p.fingerprint).toMatch(/^[a-z]+:/);
    }
    expect(new Set(phases.map((p) => p.fingerprint)).size).toBe(phases.length);
  });
  it("is idempotent", () => {
    expect(detectPhases(lib)).toEqual(phases);
  });
});

describe("portrait and evolution", () => {
  it("writes an editorial headline and period narratives", () => {
    const p = buildPortrait(lib);
    expect(p.headline).toMatch(/\w+ .* \w+/);
    expect(p.tags.length).toBeGreaterThan(2);
    const ev = buildEvolution(lib, []);
    expect(ev.periods.length).toBeGreaterThanOrEqual(2);
    for (const period of ev.periods) {
      expect(period.narrative.length).toBeGreaterThan(0);
      expect(period.representative.length).toBeGreaterThan(0);
    }
    expect(ev.periods.some((x) => x.rising.length + x.falling.length > 0)).toBe(true);
  });
});

describe("resurfacing", () => {
  it("prefers older, strongly felt, not-recently-surfaced entries", () => {
    const pick = pickResurfaceCandidate(lib, new Date(NOW));
    expect(pick).not.toBeNull();
    const ageDays = (NOW - new Date(pick!.entry.consumed_at!).getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(200);
    expect(affinity(pick!)).toBeGreaterThan(0.6);
    expect(pick!.entry.status).toBe("completed");
  });
  it("skips recently surfaced entries", () => {
    const recent = lib.map((e) => ({ ...e, resurfaces: [{ id: "r", user_id: "u", entry_id: e.entry.id, surfaced_at: new Date(NOW - 86_400_000).toISOString(), channel: "home" as const, response: null, responded_at: null, note_reaction_id: null, snoozed_until: null }] }));
    expect(pickResurfaceCandidate(recent, new Date(NOW))).toBeNull();
  });
});
