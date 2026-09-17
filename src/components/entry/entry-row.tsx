"use client";
import Link from "next/link";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import type { EntryDTO } from "@/lib/server/dto";
import { STATUS_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EntryRow({ entry, showQuote = true, className, dense }: { entry: EntryDTO; showQuote?: boolean; className?: string; dense?: boolean }) {
  const date = entry.when?.label ?? "Undated";
  return (
    <Link href={`/entry/${entry.id}`} className={cn("group flex gap-3 rounded-xl p-2 -mx-2 transition-colors hover:bg-paper-2/70 focus-visible:outline-2 focus-visible:outline-ring", className)}>
      <MediaArt title={entry.item.title} category={entry.item.category} image={entry.item.image_url} size={dense ? "sm" : "md"} />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-2">
          <CategoryChip category={entry.item.category} />
          <span className="text-[11px] text-ink-faint">· {STATUS_LABEL[entry.status]}</span>
          {entry.status !== "want" && <span className="ml-auto text-[11px] tabular-nums text-ink-faint">{date}</span>}
        </div>
        <h3 className="mt-0.5 truncate text-base leading-snug">{entry.item.title}</h3>
        {entry.item.subtitle && <p className="truncate text-xs text-ink-soft">{entry.item.subtitle}{entry.item.release_year ? ` · ${entry.item.release_year}` : ""}</p>}
        {showQuote && entry.extraction.quote && !dense && <p className="quote mt-1.5 line-clamp-2 text-sm text-ink-soft">“{entry.extraction.quote}”</p>}
        {!entry.extraction.quote && entry.extraction.tags.length > 0 && !dense && (
          <p className="mt-1.5 text-xs text-ink-faint">{entry.extraction.tags.slice(0, 3).map((t) => t.label).join(" · ")}</p>
        )}
      </div>
    </Link>
  );
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, opts);
}
