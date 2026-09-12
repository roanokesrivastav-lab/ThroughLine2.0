"use client";
import { Pin, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardSkeleton, ErrorState } from "@/components/states";
import { useTasteTags, useUpdateTastePrefs } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Optional steering. The list is the user's own vocabulary, drawn from what they
 * have logged, with the weight the engine actually derived shown next to it.
 * Nothing here is required, and nothing is asked for during onboarding.
 */
export function TasteTagsEditor() {
  const q = useTasteTags();
  const update = useUpdateTastePrefs();

  if (q.isPending) return <CardSkeleton lines={2} />;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;

  const { tags, prefs, evidence } = q.data;
  const pinned = new Set(prefs.pinned);
  const muted = new Set(prefs.muted);
  const busy = update.isPending;

  const toggle = (tag: string, list: "pinned" | "muted") => {
    const current = new Set(list === "pinned" ? prefs.pinned : prefs.muted);
    if (current.has(tag)) current.delete(tag);
    else {
      current.add(tag);
      // Pinning and muting the same tag is incoherent; the newer tap wins.
      const other = new Set(list === "pinned" ? prefs.muted : prefs.pinned);
      if (other.delete(tag)) update.mutate({ [list === "pinned" ? "muted" : "pinned"]: [...other] });
    }
    update.mutate({ [list]: [...current] });
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-5" aria-labelledby="taste-tags">
      <h2 id="taste-tags" className="flex items-center gap-2 text-lg"><Pin className="size-4 text-ink-soft" aria-hidden /> What you go for</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Worked out from what you have logged, not from a form. Pin one to lean into it, mute one to stop seeing it.
        Optional, and the engine works without touching any of this.
      </p>

      {tags.length === 0 ? (
        <p className="mt-4 text-sm text-ink-faint">Nothing to show yet. Log a few things and the kinds start to appear here.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const isPinned = pinned.has(t.tag);
            const isMuted = muted.has(t.tag);
            return (
              <li key={t.tag}>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-xs transition-colors",
                  isPinned ? "border-ember bg-ember-soft/60 text-ink" : isMuted ? "border-line bg-paper-2 text-ink-faint line-through" : "border-line bg-paper",
                )}>
                  <span>{t.tag}</span>
                  <span className="tabular-nums text-[10px] text-ink-faint">{t.weight.toFixed(2)}</span>
                  <button
                    type="button" disabled={busy} onClick={() => toggle(t.tag, "pinned")}
                    aria-pressed={isPinned} aria-label={`${isPinned ? "Unpin" : "Pin"} ${t.tag}`}
                    className="rounded-full p-0.5 hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    <Pin className={cn("size-3", isPinned ? "text-ember" : "text-ink-faint")} aria-hidden />
                  </button>
                  <button
                    type="button" disabled={busy} onClick={() => toggle(t.tag, "muted")}
                    aria-pressed={isMuted} aria-label={`${isMuted ? "Unmute" : "Mute"} ${t.tag}`}
                    className="rounded-full p-0.5 hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    <VolumeX className={cn("size-3", isMuted ? "text-ink" : "text-ink-faint")} aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        From {evidence.taggedEntries} of {evidence.entries} things logged. {evidence.notes} carry your own words, which is what shifts the engine from matching kinds to matching feeling.
      </p>
      {prefs.hidden.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <p className="text-xs text-ink-faint">{prefs.hidden.length} {prefs.hidden.length === 1 ? "thing" : "things"} you said were not for you.</p>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => update.mutate({ hidden: [] })}>Clear</Button>
        </div>
      )}
    </section>
  );
}
