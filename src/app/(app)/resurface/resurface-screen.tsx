"use client";
import Link from "next/link";
import { useState } from "react";
import { ResurfaceCard } from "@/components/resurface-card";
import { EntryRow } from "@/components/entry/entry-row";
import { PageHeader, CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useResurface } from "@/lib/api";
import type { EntryDTO } from "@/lib/server/dto";

const LABEL: Record<string, string> = { still_hits: "Still hits", doesnt_hit: "Doesn't hit anymore", not_revisited: "Haven't revisited", snoozed: "Snoozed" };

export function ResurfaceScreen() {
  const q = useResurface();
  const [card, setCard] = useState<{ eventId: string; entry: EntryDTO } | null | undefined>(undefined);
  const current = card === undefined ? q.data?.card ?? null : card;
  return (
    <div>
      <PageHeader eyebrow="Resurfacing" title="Still hits?" intro="One thing from your past, one tap. This is how the mirror learns what lasts." />
      {q.isPending ? <CardSkeleton lines={4} /> : q.isError ? <ErrorState message={q.error.message} retry={() => q.refetch()} /> : current ? (
        <ResurfaceCard key={current.eventId} card={current} onNext={(n) => { setCard(n); if (!n) q.refetch(); }} />
      ) : (
        <EmptyState title="Nothing to bring back right now" body="Throughline only resurfaces things that have had time to settle. Come back in a while, or log something new." action={<Button variant="outline" render={<Link href="/add" />}>Add something</Button>} />
      )}
      {q.data && q.data.history.length > 0 && (
        <section className="mt-8" aria-labelledby="past">
          <h2 id="past" className="eyebrow mb-2">Recent answers</h2>
          <ul className="space-y-1">
            {q.data.history.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <div className="flex-1"><EntryRow entry={h.entry} dense showQuote={false} /></div>
                <span className="shrink-0 text-[11px] text-ink-faint">{LABEL[h.response] ?? h.response}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
