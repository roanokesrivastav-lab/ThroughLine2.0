"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import { useCreateEntry } from "@/lib/api";
import type { CatalogResult } from "@/lib/catalog/types";
import { DIMENSIONS, DIMENSION_LABEL, ENTRY_STATUSES, STATUS_LABEL, type EntryStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Fast, one-handed logging. Status is the only required choice and it is preselected,
 * so a save can happen in one tap. Score, reactions and note are optional and never gate saving.
 */
export function LogSheet({ result, open, onOpenChange, onSaved, defaultStatus = "completed" }: { result: CatalogResult | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (entryId: string | null) => void; defaultStatus?: EntryStatus }) {
  if (!result) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border-line bg-paper px-5 pb-6 pt-5 sm:max-w-lg safe-bottom">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-paper-3 md:hidden" aria-hidden />
        {/* Keyed so every newly opened item starts from a clean form without effects. */}
        <LogForm key={`${result.source}:${result.external_id}:${open}`} result={result} defaultStatus={defaultStatus} onOpenChange={onOpenChange} onSaved={onSaved} />
      </SheetContent>
    </Sheet>
  );
}

function LogForm({ result, defaultStatus, onOpenChange, onSaved }: { result: CatalogResult; defaultStatus: EntryStatus; onOpenChange: (o: boolean) => void; onSaved?: (entryId: string | null) => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<EntryStatus>(defaultStatus);
  const [score, setScore] = useState<number | null>(null);
  const [dims, setDims] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const create = useCreateEntry();

  const save = () => {
    create.mutate({ result, status, private_score: score, dimensions: dims, note: note.trim() || undefined, origin: "log" }, {
      onSuccess: (data) => { setSaved(data.entry?.id ?? null); onSaved?.(data.entry?.id ?? null); },
    });
  };

  return (
    <>
        <div className="flex gap-4">
          <MediaArt title={result.title} category={result.category} image={result.image_url} size="md" />
          <div className="min-w-0 flex-1">
            <CategoryChip category={result.category} />
            <SheetTitle className="mt-1 text-balance font-serif text-2xl font-normal leading-tight">{result.title}</SheetTitle>
            <SheetDescription className="text-sm text-ink-soft">{[result.subtitle, result.release_year].filter(Boolean).join(" · ") || "Log it in a few taps."}</SheetDescription>
          </div>
        </div>

        {saved ? (
          <div className="rise mt-6 rounded-2xl bg-paper-2 p-5 text-center">
            <p className="flex items-center justify-center gap-2 text-lg"><Check className="size-5 text-ember" aria-hidden /> Saved to your history</p>
            <p className="mt-1 text-sm text-ink-soft">{note.trim() ? "Your words are being read for feeling in the background." : "Add a few words later and it will connect to more."}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={() => router.push(`/entry/${saved}`)}>Open entry</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <fieldset>
              <legend className="eyebrow mb-2">Status</legend>
              <div className="grid grid-cols-4 gap-1.5">
                {ENTRY_STATUSES.map((s) => (
                  <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
                    className={cn("rounded-lg border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", status === s ? "border-ink bg-ink text-paper" : "border-line bg-card hover:bg-paper-2")}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="eyebrow mb-2">Private score <span className="normal-case tracking-normal text-ink-faint">· optional, just for you</span></legend>
              <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Private score, 1 to 10">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={score === n} onClick={() => setScore(score === n ? null : n)}
                    className={cn("aspect-square rounded-md border text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring", score === n ? "border-ember bg-ember text-paper" : score !== null && n < score ? "border-ember/40 bg-ember-soft/60" : "border-line bg-card hover:bg-paper-2")}>
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="eyebrow mb-2">It… <span className="normal-case tracking-normal text-ink-faint">· tap any that fit</span></legend>
              <div className="flex flex-wrap gap-1.5">
                {DIMENSIONS.map((d) => (
                  <button key={d} type="button" aria-pressed={!!dims[d]} onClick={() => setDims((x) => ({ ...x, [d]: !x[d] }))}
                    className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", dims[d] ? "border-ink bg-ink text-paper" : "border-line bg-card hover:bg-paper-2")}>
                    {DIMENSION_LABEL[d]}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="log-note" className="eyebrow mb-2 block">In your words <span className="normal-case tracking-normal text-ink-faint">· optional, stays private, never rewritten</span></label>
              <Textarea id="log-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="How did it feel? What stayed with you?" className="bg-card text-[15px]" />
            </div>

            {create.isError && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
            <div className="flex items-center gap-2">
              <Button size="lg" className="flex-1" onClick={save} disabled={create.isPending}>{create.isPending ? "Saving…" : "Save"}</Button>
              <Button size="lg" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          </div>
        )}
    </>
  );
}
