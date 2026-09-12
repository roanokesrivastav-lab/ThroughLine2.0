"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Eye, Trash2 } from "lucide-react";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import { PhaseChip } from "@/components/phase-chip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CardSkeleton, ErrorState } from "@/components/states";
import { api, useEntry, useInvalidateLibrary } from "@/lib/api";
import { DIMENSIONS, DIMENSION_LABEL, ENTRY_STATUSES, STATUS_LABEL, type EntryStatus } from "@/lib/types";
import { formatDate } from "@/components/entry/entry-row";
import { describeKey } from "@/lib/taste/vocabulary";
import { cn } from "@/lib/utils";

export function EntryScreen({ id }: { id: string }) {
  const router = useRouter();
  const q = useEntry(id);
  const invalidate = useInvalidateLibrary();
  const [note, setNote] = useState("");
  const [dims, setDims] = useState<Record<string, boolean>>({});
  const [score, setScore] = useState<number | null | undefined>(undefined);
  const [external, setExternal] = useState<{ label: string; value: string } | null | "loading" | "none">(null);

  const addReaction = useMutation({
    mutationFn: () => api(`/api/entries/${id}/reactions`, { method: "POST", json: { note: note.trim() || undefined, dimensions: dims, source: "log" } }),
    onSuccess: () => { setNote(""); setDims({}); invalidate(); q.refetch(); },
  });
  const update = useMutation({
    mutationFn: (body: { status?: EntryStatus; private_score?: number | null }) => api(`/api/entries/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => { invalidate(); q.refetch(); },
  });
  const remove = useMutation({ mutationFn: () => api(`/api/entries/${id}`, { method: "DELETE" }), onSuccess: () => { invalidate(); router.push("/history"); } });

  if (q.isPending) return <div className="space-y-4"><CardSkeleton /><CardSkeleton /></div>;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  const { entry: e, connections, phases } = q.data;
  const currentScore = score === undefined ? e.private_score : score;

  const reveal = async () => {
    setExternal("loading");
    try {
      const r = await api<{ score: { label: string; value: string } | null }>(`/api/media/${e.item.id}/external-score`);
      setExternal(r.score ?? "none");
    } catch { setExternal("none"); }
  };

  return (
    <div>
      <Link href="/history" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> History</Link>
      <header className="flex gap-4">
        <MediaArt title={e.item.title} category={e.item.category} image={e.item.image_url} size="lg" />
        <div className="min-w-0 flex-1">
          <CategoryChip category={e.item.category} />
          <h1 className="mt-1 text-balance text-3xl leading-tight">{e.item.title}</h1>
          {e.item.subtitle && <p className="text-sm text-ink-soft">{e.item.subtitle}{e.item.release_year ? ` · ${e.item.release_year}` : ""}{e.item.metadata.album ? ` · ${String(e.item.metadata.album)}` : ""}</p>}
          <p className="mt-2 text-xs text-ink-faint">{STATUS_LABEL[e.status]} · {formatDate(e.consumed_at ?? e.created_at, { day: "numeric", month: "long", year: "numeric" })}</p>
          {e.extraction.summary && <p className="mt-2 text-sm text-ink-soft">In your words: <span className="quote">{e.extraction.summary}</span></p>}
        </div>
      </header>

      {/* Your words, untouched */}
      <section className="mt-6" aria-labelledby="words">
        <h2 id="words" className="eyebrow mb-2">Your words</h2>
        {e.reactions.filter((r) => r.raw_note || Object.values(r.dimensions).some(Boolean)).length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing written yet. A line below is enough to connect this to other things you love.</p>
        ) : (
          <ul className="space-y-3">
            {e.reactions.map((r) => (
              <li key={r.id} className="rounded-2xl bg-paper-2/70 p-4">
                {r.raw_note && <p className="quote whitespace-pre-wrap text-[15px] leading-relaxed">{r.raw_note}</p>}
                <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                  <span>{formatDate(r.created_at, { day: "numeric", month: "short", year: "numeric" })}{r.source === "resurface" ? " · on resurfacing" : r.source === "onboarding" ? " · onboarding" : ""}</span>
                  {Object.entries(r.dimensions).filter(([, v]) => v).map(([k]) => <span key={k} className="rounded-full border border-line px-1.5">{k === "loved" ? "Loved it" : DIMENSION_LABEL[k as keyof typeof DIMENSION_LABEL]}</span>)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {e.extraction.tags.length > 0 && (
          <p className="mt-3 text-xs text-ink-faint">Read as: {e.extraction.tags.map((t) => t.label).join(" · ")}{e.extraction.status === "pending" ? " · still reading" : ""}</p>
        )}
        {e.extraction.status === "pending" && e.extraction.tags.length === 0 && <p className="mt-3 text-xs text-ink-faint">Being read for feeling in the background.</p>}
      </section>

      {/* Add a reaction */}
      <section className="mt-6 rounded-2xl border border-line bg-card p-4" aria-labelledby="react">
        <h2 id="react" className="eyebrow mb-2">Add to it</h2>
        <div className="flex flex-wrap gap-1.5">
          {DIMENSIONS.map((d) => (
            <button key={d} type="button" aria-pressed={!!dims[d]} onClick={() => setDims((x) => ({ ...x, [d]: !x[d] }))} className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", dims[d] ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{DIMENSION_LABEL[d]}</button>
          ))}
        </div>
        <Textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={3} placeholder="How does it sit with you?" className="mt-3 bg-paper text-[15px]" aria-label="New note" />
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={() => addReaction.mutate()} disabled={addReaction.isPending || (!note.trim() && !Object.values(dims).some(Boolean))}>Save</Button>
          {addReaction.isError && <p className="text-xs text-destructive">Could not save.</p>}
        </div>
      </section>

      {/* Status + private score */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Status and private score">
        <div>
          <p className="eyebrow mb-2">Status</p>
          <div className="grid grid-cols-4 gap-1">
            {ENTRY_STATUSES.map((s) => <button key={s} type="button" aria-pressed={e.status === s} onClick={() => update.mutate({ status: s })} className={cn("rounded-lg border px-1 py-1.5 text-[11px] font-medium", e.status === s ? "border-ink bg-ink text-paper" : "border-line bg-card hover:bg-paper-2")}>{STATUS_LABEL[s]}</button>)}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-2">Private score</p>
          <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Private score">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={currentScore === n} onClick={() => { const v = currentScore === n ? null : n; setScore(v); update.mutate({ private_score: v }); }}
                className={cn("aspect-square rounded-md border text-xs tabular-nums", currentScore === n ? "border-ember bg-ember text-paper" : currentScore != null && n < currentScore ? "border-ember/40 bg-ember-soft/60" : "border-line bg-card hover:bg-paper-2")}>{n}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Connections from this entry */}
      {connections.length > 0 && (
        <section className="mt-8" aria-labelledby="conn">
          <h2 id="conn" className="eyebrow mb-3">Connects to</h2>
          <ul className="space-y-3">
            {connections.map((c) => (
              <li key={c.other.id} className="rounded-2xl border border-line bg-card p-4">
                <Link href={`/entry/${c.other.id}`} className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-ring">
                  <MediaArt title={c.other.item.title} category={c.other.item.category} image={c.other.item.image_url} size="sm" />
                  <div className="min-w-0"><CategoryChip category={c.other.item.category} /><p className="truncate text-base">{c.other.item.title}</p><p className="text-[11px] text-ink-faint">{c.shared.slice(0, 3).map((s) => describeKey(s.key)).join(" · ")}</p></div>
                </Link>
                <p className="quote mt-2 text-sm text-ink-soft">{c.explanation}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phases.length > 0 && (
        <section className="mt-8" aria-labelledby="ph">
          <h2 id="ph" className="eyebrow mb-2">Part of</h2>
          <div className="flex flex-wrap gap-1.5">{phases.map((p) => <PhaseChip key={p.id} phase={{ ...p, entryIds: [] }} />)}</div>
        </section>
      )}

      {/* Hidden-by-default external score. The user has to ask. */}
      <section className="mt-8 border-t border-line pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-faint">
          <div>
            {external === null && <button type="button" onClick={reveal} className="inline-flex items-center gap-1 underline-offset-4 hover:text-ink-soft hover:underline"><Eye className="size-3" /> Reveal the crowd score (hidden on purpose)</button>}
            {external === "loading" && <span>Looking it up…</span>}
            {external === "none" && <span>No external score available for this one.</span>}
            {typeof external === "object" && external !== null && <span>{external.label}: <strong className="text-ink-soft">{external.value}</strong>. Your own words still count for more here.</span>}
          </div>
          <button type="button" onClick={() => { if (confirm("Remove this entry and everything you wrote about it?")) remove.mutate(); }} className="inline-flex items-center gap-1 text-destructive/80 hover:text-destructive"><Trash2 className="size-3" /> Remove</button>
        </div>
      </section>
    </div>
  );
}
