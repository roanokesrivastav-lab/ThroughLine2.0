import { notFound } from "next/navigation";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { findConnections } from "@/lib/taste/connections";
import { detectPhases } from "@/lib/taste/phases";
import { buildPortrait } from "@/lib/taste/portrait";
import { pickResurfaceCandidate } from "@/lib/taste/resurface";
import { scoreCandidates, type Candidate } from "@/lib/taste/recommend";
import { CANON } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
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
  const lib = buildFixtureLibrary();
  const portrait = buildPortrait(lib);
  const connections = findConnections(lib, { limit: 5 }).map((c) => ({ a: serializeEntry(c.a), b: serializeEntry(c.b), similarity: c.similarity, shared: c.shared, explanation: c.explanation }));
  const candidate = pickResurfaceCandidate(lib);
  // Mirror the server's dedupe, including by title, so the preview does not
  // recommend the novel of a series already in the library.
  const inLib = new Set(lib.map((e) => e.item.external_id));
  const byTitle = new Set(lib.map((e) => e.item.title.toLowerCase()));
  const candidates: Candidate[] = CANON
    .filter((c) => !inLib.has(c.slug) && !byTitle.has(c.title.toLowerCase()))
    .map((c) => { const r = canonToResult(c); return { item: { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null }, vector: r.feel_prior ?? null }; });
  const recs = scoreCandidates(lib, candidates, { limit: 3 });
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
          <div className="space-y-3">{recs.map((r) => <RecCard key={r.item.id} rec={r} />)}</div>
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
