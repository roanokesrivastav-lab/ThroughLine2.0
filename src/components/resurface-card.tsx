"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Clock, MoonStar, Sparkles } from "lucide-react";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, useInvalidateLibrary } from "@/lib/api";
import type { EntryDTO } from "@/lib/server/dto";
import type { ResurfaceResponse } from "@/lib/types";
import { formatDate } from "@/components/entry/entry-row";
import { cn } from "@/lib/utils";

type Card = { eventId: string; entry: EntryDTO };

/**
 * The input spine. One question, three taps, an optional line afterwards.
 * Saves the tap immediately; the note is a separate, optional second save.
 */
export function ResurfaceCard({ card, onNext, className, compact }: { card: Card; onNext?: (next: Card | null) => void; className?: string; compact?: boolean }) {
  const [answered, setAnswered] = useState<ResurfaceResponse | null>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState<Card | null | undefined>(undefined);
  const invalidate = useInvalidateLibrary();

  const respond = useMutation({
    mutationFn: (body: { response: ResurfaceResponse; note?: string; snooze_days?: number }) => api<{ next: Card | null }>(`/api/resurface/${card.eventId}`, { method: "POST", json: body }),
    onSuccess: (data, vars) => { setAnswered(vars.response); setNext(data.next); if (vars.note !== undefined) invalidate(); },
  });

  const e = card.entry;
  const when = e.consumed_at ?? e.created_at;

  return (
    <article className={cn("relative overflow-hidden rounded-2xl border border-line bg-card p-4 md:p-5", className)} aria-live="polite">
      <p className="eyebrow mb-3">From your history</p>
      <div className="flex gap-4">
        <MediaArt title={e.item.title} category={e.item.category} image={e.item.image_url} size={compact ? "md" : "lg"} />
        <div className="min-w-0 flex-1">
          <CategoryChip category={e.item.category} />
          <h3 className="mt-1 text-balance text-2xl leading-tight">{e.item.title}</h3>
          {e.item.subtitle && <p className="text-sm text-ink-soft">{e.item.subtitle}</p>}
          <p className="mt-1 text-xs text-ink-faint">{formatDate(when, { month: "long", year: "numeric" })}</p>
          {e.extraction.quote && <p className="quote mt-3 text-[15px] leading-relaxed text-ink-soft">“{e.extraction.quote}”</p>}
        </div>
      </div>

      {answered === null ? (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Still hits?</p>
          <div className="grid grid-cols-3 gap-2">
            <Tap icon={<Sparkles className="size-4" />} label="Still hits" onClick={() => respond.mutate({ response: "still_hits" })} disabled={respond.isPending} tone="ember" />
            <Tap icon={<MoonStar className="size-4" />} label="Doesn't hit anymore" onClick={() => respond.mutate({ response: "doesnt_hit" })} disabled={respond.isPending} />
            <Tap icon={<Clock className="size-4" />} label="Haven't revisited" onClick={() => respond.mutate({ response: "not_revisited" })} disabled={respond.isPending} />
          </div>
          <button type="button" onClick={() => respond.mutate({ response: "snoozed", snooze_days: 30 })} className="mt-2 text-xs text-ink-faint underline-offset-4 hover:text-ink-soft hover:underline focus-visible:outline-2 focus-visible:outline-ring">Not now — ask again in a month</button>
          {respond.isError && <p className="mt-2 text-xs text-destructive">Could not save. Try again.</p>}
        </div>
      ) : (
        <div className="mt-5 rise">
          <p className="flex items-center gap-2 text-sm text-ink-soft"><Check className="size-4 text-ember" aria-hidden /> {labelFor(answered)}</p>
          {answered !== "snoozed" && next !== undefined && !respond.variables?.note && (
            <form className="mt-3" onSubmit={(ev) => { ev.preventDefault(); if (note.trim()) respond.mutate({ response: answered, note: note.trim() }); }}>
              <label htmlFor={`note-${card.eventId}`} className="mb-1 block text-xs text-ink-faint">Anything to add? A line is plenty. Optional.</label>
              <Textarea id={`note-${card.eventId}`} value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} placeholder="How does it sit with you now?" className="bg-paper text-[15px]" />
              <div className="mt-2 flex items-center gap-2">
                <Button type="submit" size="sm" disabled={!note.trim() || respond.isPending}>Save note</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => onNext?.(next ?? null)}>{next ? "Next one" : "Done"}</Button>
              </div>
            </form>
          )}
          {(answered === "snoozed" || respond.variables?.note) && (
            <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={() => onNext?.(next ?? null)}>{next ? "Next one" : "Done"}</Button>
          )}
        </div>
      )}
    </article>
  );
}

function Tap({ icon, label, onClick, disabled, tone }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: "ember" }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-xs font-medium leading-tight transition-all active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
        tone === "ember" ? "border-ember/40 bg-ember-soft/60 text-ink hover:bg-ember-soft" : "border-line bg-paper hover:bg-paper-2")}>
      <span className="text-ink-soft" aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

function labelFor(r: ResurfaceResponse) {
  return { still_hits: "Still hits. Noted.", doesnt_hit: "Doesn't hit anymore. That is useful to know.", not_revisited: "Haven't revisited. Maybe it is time.", snoozed: "Snoozed for a month." }[r];
}
