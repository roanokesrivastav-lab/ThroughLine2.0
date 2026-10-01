"use client";
import Link from "next/link";
import { useState } from "react";
import { PenLine, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortraitCard } from "@/components/portrait-card";
import { ConnectionCard } from "@/components/connection-card";
import { ResurfaceCard } from "@/components/resurface-card";
import { RecCard } from "@/components/rec-card";
import { CardSkeleton, EmptyState, ErrorState, SectionHeader } from "@/components/states";
import { ThreadMark } from "@/components/shell/app-shell";
import { useHome, useProfile } from "@/lib/api";
import { LogSheet } from "@/components/log-sheet";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function HomeScreen() {
  const home = useHome();
  const profile = useProfile();
  const [card, setCard] = useState<{ eventId: string; entry: import("@/lib/server/dto").EntryDTO } | null | undefined>(undefined);
  const [adding, setAdding] = useState<Recommendation | null>(null);

  const resurface = card === undefined ? home.data?.resurface ?? null : card;

  return (
    <div>
      <header className="mb-5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 md:hidden"><ThreadMark /><span className="font-serif text-xl">Throughline</span></Link>
        <p className="hidden text-sm text-ink-faint md:block">{greeting()}</p>
        <Link href="/settings" aria-label="Settings" className="rounded-full p-2 text-ink-soft hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"><Settings className="size-5" /></Link>
      </header>

      {home.isPending ? (
        <div className="space-y-4"><CardSkeleton lines={2} /><CardSkeleton /><CardSkeleton /></div>
      ) : home.isError ? (
        <ErrorState message={home.error.message} retry={() => home.refetch()} />
      ) : home.data.counts.entries === 0 ? (
        <EmptyHome onboarded={!!profile.data?.onboardingCompletedAt} />
      ) : (
        <div className="space-y-8">
          <PortraitCard portrait={home.data.portrait} className="rise" />

          {resurface && (
            <section aria-labelledby="resurface-heading" className="rise rise-2">
              <h2 id="resurface-heading" className="sr-only">Resurfacing</h2>
              <ResurfaceCard card={resurface} onNext={(n) => setCard(n)} />
            </section>
          )}

          <section aria-labelledby="connections-heading" className="rise rise-3">
            <SectionHeader eyebrow="Connections in feeling" title={<span id="connections-heading">Lines between things you love</span>} href={home.data.connections.length ? "/connections" : undefined} />
            {home.data.connections.length === 0 ? (
              <EmptyState icon={<PenLine className="size-5" />} title="Connections need your words" body={home.data.counts.pendingExtractions > 0 ? "Your notes are being read for feeling. Check back in a moment." : "Write a line or two about a couple of things across different categories, and the lines between them will appear here."}
                action={<Button variant="outline" render={<Link href="/history" />}>Add words to something</Button>} />
            ) : (
              <div className="space-y-3">
                {home.data.connections.slice(0, 5).map((c, i) => <ConnectionCard key={`${c.a.id}-${c.b.id}`} c={c} className={cn("rise", i < 4 && `rise-${i + 1}`)} />)}
              </div>
            )}
          </section>

          {home.data.recommendations.length > 0 && (
            <section aria-labelledby="recs-heading" className="rise rise-4">
              <SectionHeader eyebrow="If you want something new" title={<span id="recs-heading">A few threads to follow</span>} href="/recommend" hrefLabel="More" />
              <div className="space-y-3">
                {home.data.recommendations.slice(0, 3).map((r) => <RecCard key={r.snapshot.key} rec={r} onAdd={setAdding} />)}
              </div>
            </section>
          )}

          <p className="pt-2 text-center text-xs text-ink-faint">{home.data.counts.entries} things · {home.data.counts.withWords} with your words · {home.data.counts.phases} phases noticed</p>
        </div>
      )}

      <LogSheet result={adding ? { ...adding.item, feel_prior: adding.item.feel_prior } : null} open={!!adding} onOpenChange={(o) => { if (!o) setAdding(null); }} defaultStatus="want" />
    </div>
  );
}

function EmptyHome({ onboarded }: { onboarded: boolean }) {
  return (
    <div className="rise">
      <div className="rounded-3xl bg-paper-2/70 px-6 py-10 text-center md:py-14">
        <ThreadMark className="mx-auto mb-4 h-8 w-14 text-ink" />
        <h1 className="text-balance text-3xl md:text-4xl">A mirror, not a scoreboard.</h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-ink-soft">Throughline notices the lines between the things you love — a film and a song, a novel and a series — in feeling and in time. It starts with a few things you have loved.</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button size="lg" render={<Link href="/onboarding" />}><Sparkles className="size-4" data-icon="inline-start" /> {onboarded ? "Revisit the opening" : "Begin with what you love"}</Button>
          <Button size="lg" variant="outline" render={<Link href="/add" />}>Add one thing</Button>
        </div>
        <p className="mt-5 text-xs text-ink-faint">Everything here is private. No feeds, no followers, no scores from anyone else.</p>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Late." : h < 12 ? "Morning." : h < 18 ? "Afternoon." : "Evening.";
}
