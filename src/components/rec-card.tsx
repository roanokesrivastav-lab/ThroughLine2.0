"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus, X } from "lucide-react";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import { Button } from "@/components/ui/button";
import type { Recommendation } from "@/lib/types";
import { describeKey } from "@/lib/taste/vocabulary";
import { ROUTE_LABEL } from "@/lib/taste/recommend";
import { listTags } from "@/lib/taste/tag-lexicon";
import { useHideRecommendation } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A recommendation always shows its explanation, the route that produced it, and
 * on request the whole arithmetic behind it. The breakdown is the point: you
 * should be able to open it and decide for yourself whether the engine is right.
 */
export function RecCard({ rec, onAdd, className, style }: { rec: Recommendation; onAdd?: (rec: Recommendation) => void; className?: string; style?: React.CSSProperties }) {
  const [debug, setDebug] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const hide = useHideRecommendation();
  const item = rec.item;
  const b = rec.breakdown;
  const matched = b.matchedTags.map((m) => m.tag);

  if (dismissed) {
    return (
      <article className={cn("rounded-2xl border border-dashed border-line bg-paper-2/40 px-4 py-3 text-sm text-ink-soft", className)} style={style} aria-live="polite">
        <span>Noted. {item.title} will not come back.</span>
        <button
          type="button"
          className="ml-2 underline underline-offset-4 hover:text-ink"
          onClick={() => { setDismissed(false); hide.mutate({ candidate_key: candidateKeyOf(item), undo: true }); }}
        >
          Undo
        </button>
      </article>
    );
  }

  return (
    <article className={cn("rounded-2xl border border-line bg-card p-4 md:p-5", className)} style={style}>
      <div className="flex gap-4">
        <MediaArt title={item.title} category={item.category} image={item.image_url} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CategoryChip category={item.category} />
            <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-faint">{ROUTE_LABEL[rec.route]}</span>
            {rec.fits && <span className="ml-auto rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-soft">{rec.fits}</span>}
          </div>
          <h3 className="mt-1 text-balance text-xl leading-tight">{item.title}</h3>
          {item.subtitle && <p className="text-sm text-ink-soft">{item.subtitle}{item.release_year ? ` · ${item.release_year}` : ""}</p>}
          {rec.entryId && <p className="mt-0.5 text-[11px] text-ink-faint">On your list</p>}
        </div>
      </div>

      <p className="mt-3 text-pretty text-[15px] leading-relaxed">{rec.explanation}</p>

      {rec.bridge && (
        <p className="mt-2 text-xs text-ink-soft">
          Connects to <Link href={`/entry/${rec.bridge.entryId}`} className="font-medium underline-offset-4 hover:underline">{rec.bridge.title}</Link>
          {rec.bridge.shared.length > 0 && <> · {rec.bridge.shared.slice(0, 3).map((s) => describeKey(s.key)).join(", ")}</>}
        </p>
      )}
      {matched.length > 0 && rec.route !== "feeling" && (
        <p className="mt-1 text-xs text-ink-faint">Matched on {listTags(matched.slice(0, 3))}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onAdd && !rec.entryId && <Button size="sm" variant="outline" onClick={() => onAdd(rec)}><Plus className="size-3.5" data-icon="inline-start" /> Add to list</Button>}
        {rec.entryId && <Button size="sm" variant="outline" render={<Link href={`/entry/${rec.entryId}`} />}>Open</Button>}
        <button
          type="button"
          onClick={() => { setDismissed(true); hide.mutate({ candidate_key: candidateKeyOf(item) }); }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-ink-faint hover:bg-paper-2 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-3" aria-hidden /> Not for me
        </button>
        <button type="button" onClick={() => setDebug((d) => !d)} aria-expanded={debug} className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-ring">
          Why this <ChevronDown className={cn("size-3 transition-transform", debug && "rotate-180")} aria-hidden />
        </button>
      </div>

      {debug && (
        <div className="mt-3 space-y-2 rounded-lg bg-paper-2/70 p-3 text-[11px] text-ink-soft">
          <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-1">
            <dt className="text-ink-faint">signal</dt>
            <dd className="text-right text-ink-faint">reading × weight</dd>
            <dd className="text-right text-ink-faint">adds</dd>
            {b.components.map((c) => (
              <Fragmentish key={c.key}>
                <dt className="truncate">{c.label}</dt>
                <dd className="text-right tabular-nums">{c.value === null ? "no evidence" : `${c.value.toFixed(2)} × ${c.weight.toFixed(2)}`}</dd>
                <dd className="text-right tabular-nums">{c.value === null ? "—" : c.contribution.toFixed(3)}</dd>
              </Fragmentish>
            ))}
            {b.adjustments.map((a) => (
              <Fragmentish key={a.key}>
                <dt className="truncate">{a.label}</dt>
                <dd className="text-right tabular-nums text-ink-faint">adjustment</dd>
                <dd className="text-right tabular-nums">{a.delta > 0 ? "+" : ""}{a.delta.toFixed(3)}</dd>
              </Fragmentish>
            ))}
            <dt className="font-medium text-ink">Total</dt>
            <dd />
            <dd className="text-right font-medium tabular-nums text-ink">{rec.score.toFixed(3)}</dd>
          </dl>
          {b.matchedTags.length > 0 && (
            <p className="border-t border-line pt-2">
              Tags: {b.matchedTags.map((m) => `${m.tag} ${m.profileWeight.toFixed(2)}${m.via !== m.tag ? ` (via ${m.via})` : ""}`).join(" · ")}
              {" · "}coverage {b.tagCoverage.toFixed(2)}
            </p>
          )}
          {b.creator && <p>Creator: {b.creator.name}, {b.creator.entryIds.length} in your history.</p>}
        </div>
      )}
    </article>
  );
}

/** `<>` inside a `<dl>` grid, without needing a key-bearing wrapper element. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function candidateKeyOf(item: Recommendation["item"]): string {
  return item.id.includes(":") ? item.id : `${item.source}:${item.external_id}`;
}
