"use client";
import Link from "next/link";
import { useState } from "react";
import { Shuffle } from "lucide-react";
import { RecCard } from "@/components/rec-card";
import { LogSheet } from "@/components/log-sheet";
import { PageHeader, CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useRecommend } from "@/lib/api";
import { CATEGORIES, CATEGORY_PLURAL, type Category, type Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

const TIME = [["20", "20 minutes"], ["40", "40 minutes"], ["60", "An hour"], ["150", "An evening"]] as const;

/** Structured filters → deterministic scoring → explanation. Always three to five, never one forced pick. */
export function RecommendScreen({ category }: { category?: Category }) {
  const [minutes, setMinutes] = useState<string | undefined>();
  const [mode, setMode] = useState<"new" | "list" | "surprise">("new");
  const [shortRead, setShortRead] = useState(false);
  const [returnable, setReturnable] = useState(false);
  const [adding, setAdding] = useState<Recommendation | null>(null);
  const [surpriseSeed, setSurpriseSeed] = useState(0);

  const params = { category, minutes, listOnly: mode === "list" ? "1" : undefined, surprise: mode === "surprise" ? "1" : undefined, shortRead: shortRead ? "1" : undefined, returnable: returnable ? "1" : undefined, s: mode === "surprise" ? String(surpriseSeed) : undefined };
  const q = useRecommend(params);

  return (
    <div>
      <PageHeader eyebrow="Find" title={category ? `${CATEGORY_PLURAL[category]} you might love.` : "Something you would never have found."} intro="Chosen from your own history and words, never from what is trending. Every pick says why." />

      <nav className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Category">
        <Link href="/recommend" className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", !category ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-soft hover:bg-paper-2")}>Anything</Link>
        {CATEGORIES.map((c) => <Link key={c} href={`/recommend/${c}`} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", category === c ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-soft hover:bg-paper-2")}>{CATEGORY_PLURAL[c]}</Link>)}
      </nav>

      <div className="mb-5 space-y-3 rounded-2xl border border-line bg-card p-4">
        <div>
          <p className="eyebrow mb-1.5">I have…</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time available">
            {TIME.map(([v, l]) => <button key={v} type="button" aria-pressed={minutes === v} onClick={() => setMinutes(minutes === v ? undefined : v)} className={cn("rounded-full border px-3 py-1 text-xs", minutes === v ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{l}</button>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mood">
          <button type="button" aria-pressed={shortRead} onClick={() => setShortRead(!shortRead)} className={cn("rounded-full border px-3 py-1 text-xs", shortRead ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>Something short to read</button>
          <button type="button" aria-pressed={returnable} onClick={() => setReturnable(!returnable)} className={cn("rounded-full border px-3 py-1 text-xs", returnable ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>Something I can return to</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3" role="group" aria-label="Source">
          {(["new", "list"] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("rounded-full border px-3 py-1 text-xs", mode === m ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{m === "new" ? "Something new" : "From my list"}</button>)}
          <button type="button" aria-pressed={mode === "surprise"} onClick={() => { setMode("surprise"); setSurpriseSeed((s) => s + 1); }} className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs", mode === "surprise" ? "border-ember bg-ember text-paper" : "border-line bg-paper hover:bg-paper-2")}><Shuffle className="size-3" aria-hidden /> Surprise me from my list</button>
        </div>
      </div>

      <section aria-live="polite">
        {q.isPending ? <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div> : q.isError ? <ErrorState message={q.error.message} retry={() => q.refetch()} /> : q.data.recommendations.length === 0 ? (
          <EmptyState title={mode !== "new" ? "Your list is empty for that" : "Nothing fits yet"} body={mode !== "new" ? "Add a few things you want to get to, then come back." : "Loosen the time filter, or write a few words about things you loved so there is more to go on."} action={<Button variant="outline" render={<Link href="/add" />}>Add something</Button>} />
        ) : (
          <div className="space-y-3">{q.data.recommendations.map((r, i) => <RecCard key={r.snapshot.key} rec={r} onAdd={setAdding} className={cn("rise", i < 4 && `rise-${i + 1}`)} />)}</div>
        )}
      </section>

      <LogSheet result={adding ? { ...adding.item, feel_prior: adding.item.feel_prior } : null} open={!!adding} onOpenChange={(o) => { if (!o) setAdding(null); }} defaultStatus="want" />
    </div>
  );
}
