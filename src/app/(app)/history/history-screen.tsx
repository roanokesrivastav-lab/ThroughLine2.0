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
import { seasonOf } from "@/lib/taste/when";

const monthLabel = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

type Group = { key: string; label: string; href: string | null; sort: string; items: EntryDTO[] };

/** Group by the honest precision of each date: months for exact ones, seasons, "sometime in 2019", or undated. */
function groupOf(e: EntryDTO): Omit<Group, "items"> {
  const w = e.when;
  if (e.status === "want") return { key: "want", label: "Want to", href: null, sort: "9999-99-99" };
  if (!w) return { key: "undated", label: "Not dated yet", href: "/timeline#undated", sort: "0000-00-00" };
  const mid = new Date(`${w.mid}T00:00:00Z`);
  if (w.precision === "day" || w.precision === "month") { const ym = w.mid.slice(0, 7); return { key: ym, label: monthLabel(ym), href: `/history/${ym}`, sort: w.mid }; }
  if (w.precision === "season") { const s = seasonOf(mid); return { key: `${s.year}-${s.season}`, label: w.label, href: `/history/${s.year}-${s.season}`, sort: w.mid }; }
  if (w.precision === "year") return { key: w.start.slice(0, 4), label: `Sometime in ${w.start.slice(0, 4)}`, href: `/history/${w.start.slice(0, 4)}`, sort: `${w.start.slice(0, 4)}-00` };
  return { key: `range-${w.start}-${w.end}`, label: w.label.replace("~", "Across "), href: null, sort: w.mid };
}

export function HistoryScreen() {
  const [category, setCategory] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [year, setYear] = useState<string | undefined>();
  const entries = useEntries({ category, status, year });
  const all = useEntries({});
  const phases = usePhases();

  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const e of all.data?.entries ?? []) if (e.when) ys.add(e.when.mid.slice(0, 4));
    return [...ys].sort().reverse();
  }, [all.data]);

  const grouped = useMemo(() => {
    const m = new Map<string, Group>();
    for (const e of entries.data?.entries ?? []) {
      const g = groupOf(e);
      const cur = m.get(g.key) ?? { ...g, items: [] };
      cur.items.push(e);
      m.set(g.key, cur);
    }
    return [...m.values()].sort((a, b) => b.sort.localeCompare(a.sort));
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
          {grouped.map((g) => (
            <section key={g.key} aria-labelledby={`m-${g.key}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 id={`m-${g.key}`} className="text-lg">{g.href ? <Link href={g.href} className="underline-offset-4 hover:underline">{g.label}</Link> : g.label}</h2>
                <span className="text-xs text-ink-faint">{g.items.length}</span>
              </div>
              {g.key === "undated" && <p className="-mt-1 mb-2 text-xs text-ink-faint">Open one and say roughly when, or date them all from the <Link href="/timeline#undated" className="underline underline-offset-4">timeline</Link>.</p>}
              <div className="space-y-1">{g.items.map((e) => <EntryRow key={e.id} entry={e} />)}</div>
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
