import { notFound } from "next/navigation";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { findConnections } from "@/lib/taste/connections";
import { detectPhases } from "@/lib/taste/phases";
import { buildPortrait } from "@/lib/taste/portrait";
import { pickResurfaceCandidate } from "@/lib/taste/resurface";
import { generateCandidates } from "@/lib/taste/candidates";
import { buildUserProfile } from "@/lib/taste/profile";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import { rankPipeline } from "@/lib/taste/pipeline";
import { toRecommendation } from "@/lib/server/stage-recommend";
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { serializeEntry } from "@/lib/server/dto";
import { AppShell } from "@/components/shell/app-shell";
import { PortraitCard } from "@/components/portrait-card";
import { ConnectionCard } from "@/components/connection-card";
import { ResurfaceCard } from "@/components/resurface-card";
import { RecCard } from "@/components/rec-card";
import { EntryRow } from "@/components/entry/entry-row";
import { PhaseChip } from "@/components/phase-chip";
import { SectionHeader } from "@/components/states";

/**
 * Development-only preview of the Mirror rendered from in-memory fixtures (no database).
 * Used to check layout and copy on a phone-sized viewport. Returns 404 in production.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const now = new Date();
  const lib = buildFixtureLibrary(now.getTime(), { profiles: "canon" });
  const portrait = buildPortrait(lib);
  const connections = findConnections(lib, { limit: 5 }).map((c) => ({ a: serializeEntry(c.a), b: serializeEntry(c.b), similarity: c.similarity, shared: c.shared, explanation: c.explanation }));
  const candidate = pickResurfaceCandidate(lib);
  const P = buildUserProfile(lib, [], EMPTY_TASTE_PREFS, now);
  // The canon deck exactly as the server builds it (stage-recommend.ts): committed
  // profiles attached, keyed `canon:<slug>`.
  const canon = CANON.map((c) => {
    const r = canonToResult(c);
    return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
  });
  // The pure Stage 3 path: candidates → rankPipeline → display rows. No pool, no
  // creator expansion, no store, no explainer — deterministic sentences only.
  const { candidates, sourceCounts, merged } = generateCandidates({ library: lib, P, filters: { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 3 }, canon, creatorResults: new Map(), pool: [] });
  const { snapshots } = rankPipeline({ P, library: lib, prefs: EMPTY_TASTE_PREFS, candidates, filters: { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 3 }, recent: [], userId: "dev-preview", now, sourceCounts, merged });
  const recs = snapshots.map((s) => {
    const item = candidates.find((c) => c.key === s.key)?.item;
    if (!item) throw new Error(`[preview] shown key ${s.key} missing from candidates`);
    return toRecommendation(s, item);
  });
  const phases = detectPhases(lib).map((p, i) => ({ ...p, id: `p${i}`, user_id: "u", user_label: null, dismissed: false, detected_at: "" }));
  const recent = lib.slice(0, 4).map(serializeEntry);

  return (
    <AppShell>
      <p className="mb-4 rounded-lg bg-ember-soft/60 px-3 py-2 text-xs">Dev preview: fixtures only, no database. Buttons that write will fail.</p>
      <div className="space-y-8">
        <PortraitCard portrait={portrait} />
        {candidate && <ResurfaceCard card={{ eventId: "preview", entry: serializeEntry(candidate) }} />}
        <section>
          <SectionHeader eyebrow="Connections in feeling" title="Lines between things you love" href="/connections" />
          <div className="space-y-3">{connections.map((c) => <ConnectionCard key={`${c.a.id}-${c.b.id}`} c={c} />)}</div>
        </section>
        <section>
          <SectionHeader eyebrow="If you want something new" title="A few threads to follow" href="/recommend" hrefLabel="More" />
          <div className="space-y-3">{recs.map((r) => <RecCard key={r.snapshot.key} rec={r} />)}</div>
        </section>
        <section>
          <SectionHeader eyebrow="Phases noticed" title="Inferred, never declared" />
          <div className="flex flex-wrap gap-1.5">{phases.map((p) => <PhaseChip key={p.id} phase={p} link={false} />)}</div>
        </section>
        <section>
          <SectionHeader eyebrow="History" title="Recent" />
          <div className="space-y-1">{recent.map((e) => <EntryRow key={e.id} entry={e} />)}</div>
        </section>
      </div>
    </AppShell>
  );
}
