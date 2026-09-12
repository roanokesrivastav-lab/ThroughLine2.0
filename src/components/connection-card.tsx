"use client";
import Link from "next/link";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import type { ConnectionDTO } from "@/lib/api";
import { describeKey } from "@/lib/taste/vocabulary";
import { cn } from "@/lib/utils";

/** One cross-media connection. The explanation is the point; the covers are supporting cast. */
export function ConnectionCard({ c, className, style }: { c: ConnectionDTO; className?: string; style?: React.CSSProperties }) {
  return (
    <article className={cn("rounded-2xl border border-line bg-card p-4 md:p-5", className)} style={style}>
      <div className="flex items-center gap-3">
        <Link href={`/entry/${c.a.id}`} className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring"><MediaArt title={c.a.item.title} category={c.a.item.category} image={c.a.item.image_url} size="sm" /></Link>
        <Thread />
        <Link href={`/entry/${c.b.id}`} className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring"><MediaArt title={c.b.item.title} category={c.b.item.category} image={c.b.item.image_url} size="sm" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm"><span className="font-medium">{c.a.item.title}</span> <span className="text-ink-faint">and</span> <span className="font-medium">{c.b.item.title}</span></p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]"><CategoryChip category={c.a.item.category} /><CategoryChip category={c.b.item.category} /></p>
        </div>
      </div>
      <p className="quote mt-3 text-[15px] leading-relaxed">{c.explanation}</p>
      {c.shared.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">Shared: {c.shared.slice(0, 3).map((s) => describeKey(s.key)).join(" · ")}</p>
      )}
    </article>
  );
}

function Thread() {
  return (
    <svg viewBox="0 0 48 12" className="h-3 w-12 shrink-0 text-ink-faint" aria-hidden>
      <path d="M2 6 C 14 -2, 22 14, 34 6 S 44 2, 46 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 3" />
    </svg>
  );
}
