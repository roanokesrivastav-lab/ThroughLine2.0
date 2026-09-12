"use client";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PortraitCard } from "@/components/portrait-card";
import { EntryRow } from "@/components/entry/entry-row";
import { PhaseChip } from "@/components/phase-chip";
import { PageHeader, CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useTaste } from "@/lib/api";
import { CATEGORY_PLURAL } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Taste evolution: editorial sentences per period, with the smallest possible visual support. */
export function TasteScreen() {
  const q = useTaste();
  return (
    <div>
      <PageHeader eyebrow="Taste over time" title="How you have changed." intro="Not a dashboard. A portrait in periods, drawn from your own words and the phases they cluster into." />
      {q.isPending ? <div className="space-y-4"><CardSkeleton lines={2} /><CardSkeleton /><CardSkeleton /></div> : q.isError ? <ErrorState message={q.error.message} retry={() => q.refetch()} /> : q.data.evolution.periods.length === 0 ? (
        <EmptyState title="Nothing to draw yet" body="Log a few things with dates and words and the portrait starts to move." action={<Button render={<Link href="/add" />}>Add something</Button>} />
      ) : (
        <div className="space-y-8">
          <PortraitCard portrait={q.data.portrait} />
          <div className="thread" aria-hidden />
          <ol className="relative space-y-10 border-l border-line pl-5">
            {q.data.evolution.periods.map((p, i) => (
              <li key={p.key} className={cn("relative rise", i < 4 && `rise-${i + 1}`)}>
                <span className="absolute -left-[26px] top-1.5 size-3 rounded-full border-2 border-paper bg-ink" aria-hidden />
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-2xl"><Link href={`/history/${p.key.toLowerCase()}`} className="underline-offset-4 hover:underline">{p.label}</Link></h2>
                  <span className="text-xs text-ink-faint">{p.entryCount} {p.entryCount === 1 ? "thing" : "things"}</span>
                </div>
                <p className="mt-2 text-pretty text-[15px] leading-relaxed">{p.narrative.join(" ")}</p>

                {(p.rising.length > 0 || p.falling.length > 0) && (
                  <ul className="mt-3 flex flex-wrap gap-1.5 text-xs" aria-label="Shifts from the period before">
                    {p.rising.map((r) => <li key={r.key} className="inline-flex items-center gap-1 rounded-full bg-ember-soft/70 px-2 py-1 text-ink"><ArrowUpRight className="size-3" aria-hidden /> more {r.label}</li>)}
                    {p.falling.map((r) => <li key={r.key} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-1 text-ink-soft"><ArrowDownRight className="size-3" aria-hidden /> less {r.label}</li>)}
                  </ul>
                )}

                {p.categoryMix.length > 0 && (
                  <div className="mt-3">
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-paper-3" role="img" aria-label={p.categoryMix.map((m) => `${CATEGORY_PLURAL[m.category]} ${Math.round(m.share * 100)}%`).join(", ")}>
                      {p.categoryMix.map((m) => <span key={m.category} className={`cat-${m.category}`} style={{ width: `${m.share * 100}%`, background: "var(--cat)" }} />)}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">{p.categoryMix.map((m) => `${CATEGORY_PLURAL[m.category]} ${Math.round(m.share * 100)}%`).join(" · ")}</p>
                  </div>
                )}

                {p.phases.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{p.phases.map((ph) => <PhaseChip key={ph.id} phase={{ ...ph, entryIds: q.data.phases.find((x) => x.id === ph.id)?.entryIds ?? [] }} />)}</div>}

                {p.representative.length > 0 && (
                  <div className="mt-4">
                    <p className="eyebrow mb-1">Representative</p>
                    <div className="space-y-0.5">{p.representative.map((id) => q.data.entries[id]).filter(Boolean).slice(0, 3).map((e) => <EntryRow key={e.id} entry={e} dense showQuote={false} />)}</div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
