"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EntryRow } from "@/components/entry/entry-row";
import { PhaseChip } from "@/components/phase-chip";
import { PageHeader, RowSkeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useEntries, usePhases } from "@/lib/api";
import type { EntryDTO } from "@/lib/server/dto";
import { CATEGORIES, CATEGORY_PLURAL, ENTRY_STATUSES, STATUS_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

const MONTH = (iso: string) => iso.slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

export function HistoryScreen() {
  const [category, setCategory] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [year, setYear] = useState<string | undefined>();
  const entries = useEntries({ category, status, year });
  const all = useEntries({});
  const phases = usePhases();

  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const e of all.data?.entries ?? []) ys.add((e.consumed_at ?? e.created_at).slice(0, 4));
    return [...ys].sort().reverse();
  }, [all.data]);

  const grouped = useMemo(() => {
    const m = new Map<string, EntryDTO[]>();
    for (const e of entries.data?.entries ?? []) {
      const k = MONTH(e.consumed_at ?? e.created_at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [entries.data]);

  const activePhases = (phases.data?.phases ?? []).filter((p) => !p.dismissed);

  return (
    <div>
      <PageHeader eyebrow="History" title="Everything, in time." intro="Your private record across all five categories. Browse by era to see what you were into." />

      {years.length > 0 && (
        <nav aria-label="Browse by era" className="mb-5">
          <p className="eyebrow mb-2">Browse by era</p>
          <div className="flex flex-wrap gap-1.5">
            {years.map((y) => <Link key={y} href={`/history/${y}`} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-ring">{y}</Link>)}
          </div>
          {activePhases.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-ink-faint">Phases noticed — inferred from clusters, never declared. Tap one to explore it.</p>
              <div className="flex flex-wrap gap-1.5">{activePhases.slice(0, 8).map((p) => <PhaseChip key={p.id} phase={p} />)}</div>
            </div>
          )}
        </nav>
      )}

      <div className="mb-4 space-y-2">
        <FilterRow label="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => [c, CATEGORY_PLURAL[c]])} />
        <FilterRow label="Status" value={status} onChange={setStatus} options={ENTRY_STATUSES.map((s) => [s, STATUS_LABEL[s]])} />
        {years.length > 1 && <FilterRow label="Year" value={year} onChange={setYear} options={years.map((y) => [y, y])} />}
      </div>

      {entries.isPending ? <RowSkeleton n={6} /> : entries.isError ? <ErrorState message={entries.error.message} retry={() => entries.refetch()} /> : grouped.length === 0 ? (
        <EmptyState title={all.data?.entries.length ? "Nothing matches those filters" : "Nothing here yet"} body={all.data?.entries.length ? "Loosen a filter." : "Log the last thing you finished, or begin with a few things you have loved."}
          action={all.data?.entries.length ? <Button variant="outline" onClick={() => { setCategory(undefined); setStatus(undefined); setYear(undefined); }}>Clear filters</Button> : <Button render={<Link href="/add" />}>Add something</Button>} />
      ) : (
        <div className="space-y-7">
          {grouped.map(([ym, items]) => (
            <section key={ym} aria-labelledby={`m-${ym}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 id={`m-${ym}`} className="text-lg"><Link href={`/history/${ym}`} className="underline-offset-4 hover:underline">{monthLabel(ym)}</Link></h2>
                <span className="text-xs text-ink-faint">{items.length}</span>
              </div>
              <div className="space-y-1">{items.map((e) => <EntryRow key={e.id} entry={e} />)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, value, onChange, options }: { label: string; value?: string; onChange: (v?: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]" role="group" aria-label={label}>
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      <button type="button" aria-pressed={!value} onClick={() => onChange(undefined)} className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", !value ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-2")}>All</button>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(value === v ? undefined : v)} className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", value === v ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-2")}>{l}</button>
      ))}
    </div>
  );
}
