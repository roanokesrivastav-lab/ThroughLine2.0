"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { EntryRow } from "@/components/entry/entry-row";
import { PhaseChip } from "@/components/phase-chip";
import { PortraitCard } from "@/components/portrait-card";
import { PageHeader, RowSkeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useEntries, useInvalidateLibrary, usePhases } from "@/lib/api";
import { buildPortrait } from "@/lib/taste/portrait";
import { confidenceLabel } from "@/lib/taste/phases";
import type { EntryDTO } from "@/lib/server/dto";
import type { EntryWithContext } from "@/lib/types";
import { CATEGORY_PLURAL } from "@/lib/types";
import { seasonBounds, type Season } from "@/lib/taste/when";

/** Resolve a period key: 2024 | 2024-03 | 2024-q2 | 2024-h1 | 2024-summer | phase-<id> */
function resolve(period: string): { from?: string; to?: string; label: string; phaseId?: string } {
  if (period.startsWith("phase-")) return { label: "Phase", phaseId: period.slice(6) };
  const y = period.match(/^(\d{4})$/);
  if (y) return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31`, label: y[1] };
  const ym = period.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const last = new Date(Date.UTC(Number(ym[1]), Number(ym[2]), 0)).getUTCDate();
    return { from: `${ym[1]}-${ym[2]}-01`, to: `${ym[1]}-${ym[2]}-${String(last).padStart(2, "0")}`, label: new Date(`${ym[1]}-${ym[2]}-15T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  const q = period.match(/^(\d{4})-q([1-4])$/i);
  if (q) { const s = (Number(q[2]) - 1) * 3 + 1; const e = s + 2; const last = new Date(Date.UTC(Number(q[1]), e, 0)).getUTCDate(); return { from: `${q[1]}-${String(s).padStart(2, "0")}-01`, to: `${q[1]}-${String(e).padStart(2, "0")}-${last}`, label: `Q${q[2]} ${q[1]}` }; }
  const s = period.match(/^(\d{4})-(winter|spring|summer|autumn)$/i);
  if (s) { const b = seasonBounds(Number(s[1]), s[2].toLowerCase() as Season); return { from: b.from, to: b.to, label: `${s[2].charAt(0).toUpperCase()}${s[2].slice(1).toLowerCase()} ${s[1]}` }; }
  const h = period.match(/^(\d{4})-h([12])$/i);
  if (h) return h[2] === "1" ? { from: `${h[1]}-01-01`, to: `${h[1]}-06-30`, label: `Early ${h[1]}` } : { from: `${h[1]}-07-01`, to: `${h[1]}-12-31`, label: `Late ${h[1]}` };
  return { label: period };
}

/** Turn DTOs back into the shape the portrait builder wants (enough of it for a period sketch). */
function toContext(e: EntryDTO): EntryWithContext {
  return {
    entry: { id: e.id, user_id: "", media_item_id: e.item.id, status: e.status, private_score: e.private_score, consumed_at: e.consumed_at, consumed_until: e.consumed_until, consumed_precision: e.consumed_precision, origin: e.origin, created_at: e.created_at, updated_at: e.created_at },
    item: e.item, reactions: e.reactions, resurfaces: [],
    extractions: e.extraction.tags.length ? [{ id: "", reaction_id: "", entry_id: e.id, user_id: "", status: "done", attributes: null, vector: Object.fromEntries(e.extraction.tags.map((t) => [t.key, t.weight])), vocabulary_version: "v1", extractor: null, attempts: 1, last_error: null, extracted_at: e.created_at, created_at: e.created_at }] : [],
  };
}

export function PeriodScreen({ period }: { period: string }) {
  const r = useMemo(() => resolve(period), [period]);
  const phases = usePhases();
  const phase = r.phaseId ? phases.data?.phases.find((p) => p.id === r.phaseId) : undefined;
  const range = phase ? { from: phase.start_at, to: phase.end_at } : { from: r.from, to: r.to };
  const entries = useEntries(range);
  const invalidate = useInvalidateLibrary();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const rename = useMutation({ mutationFn: (user_label: string | null) => api(`/api/phases/${phase?.id}`, { method: "PATCH", json: { user_label } }), onSuccess: () => { invalidate(); setEditing(false); } });
  const dismiss = useMutation({ mutationFn: () => api(`/api/phases/${phase?.id}`, { method: "PATCH", json: { dismissed: true } }), onSuccess: invalidate });

  const items = useMemo(() => {
    const list = entries.data?.entries ?? [];
    if (phase) { const set = new Set(phase.entryIds); return list.filter((e) => set.has(e.id)); }
    return list;
  }, [entries.data, phase]);
  const portrait = useMemo(() => buildPortrait(items.map(toContext)), [items]);
  const overlapping = (phases.data?.phases ?? []).filter((p) => !p.dismissed && !phase && range.from && range.to && p.start_at <= range.to && p.end_at >= range.from);

  const title = phase ? (phase.user_label ?? phase.label) : r.label;

  return (
    <div>
      <Link href="/timeline" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> Timeline</Link>
      <PageHeader eyebrow={phase ? `A ${confidenceLabel(phase.confidence)} phase · ${phase.category ? CATEGORY_PLURAL[phase.category] : "cross-media"}` : "An era"} title={title}
        intro={phase ? `${new Date(phase.start_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })} to ${new Date(phase.end_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}. Noticed automatically from a cluster of ${phase.entryIds.length} entries. You can rename it or tell Throughline it is wrong.` : "What you were into, across every category."}
        action={phase && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Rename phase" onClick={() => { setLabel(phase.user_label ?? phase.label); setEditing(true); }}><Pencil /></Button>
          </div>
        )} />

      {phase && editing && (
        <form className="mb-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(label.trim() || null); }}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Phase label" className="bg-card" maxLength={80} />
          <Button type="submit" disabled={rename.isPending}>Save</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
      {phase && (
        <p className="mb-5 text-xs text-ink-faint">Not a real phase? <button type="button" className="underline underline-offset-4 hover:text-ink" onClick={() => dismiss.mutate()}>Dismiss it</button>.</p>
      )}

      {entries.isPending ? <RowSkeleton n={5} /> : entries.isError ? <ErrorState message={entries.error.message} retry={() => entries.refetch()} /> : items.length === 0 ? (
        <EmptyState title="Nothing in this stretch" body="Try a wider period from History." />
      ) : (
        <div className="space-y-6">
          {items.length >= 2 && <PortraitCard portrait={{ ...portrait, headline: portrait.entryCount ? portrait.headline : title }} compact />}
          {overlapping.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Phases in this stretch</p>
              <div className="flex flex-wrap gap-1.5">{overlapping.map((p) => <PhaseChip key={p.id} phase={p} />)}</div>
            </div>
          )}
          <div>
            <p className="eyebrow mb-2">{items.length} {items.length === 1 ? "entry" : "entries"}</p>
            <div className="space-y-1">{items.map((e) => <EntryRow key={e.id} entry={e} />)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
