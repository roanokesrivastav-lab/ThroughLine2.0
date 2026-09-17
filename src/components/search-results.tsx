"use client";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import type { CatalogResult } from "@/lib/catalog/types";
import { BOOK_KIND_LABEL, type BookKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Web novel", "Manga"… shown for books that are not plain novels. */
export function kindLabel(r: { category: string; metadata: { book_kind?: BookKind } }): string | null {
  const k = r.metadata.book_kind;
  return r.category === "book" && k && k !== "novel" ? BOOK_KIND_LABEL[k] : null;
}

export function SearchResultRow({ r, onSelect, className, showOverview = true }: { r: CatalogResult; onSelect: (r: CatalogResult) => void; className?: string; showOverview?: boolean }) {
  return (
    <button type="button" onClick={() => onSelect(r)} className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-paper-2/70 focus-visible:outline-2 focus-visible:outline-ring", className)}>
      <MediaArt title={r.title} category={r.category} image={r.image_url} size="sm" />
      <div className="min-w-0 flex-1">
        <CategoryChip category={r.category} />
        <p className="truncate text-[15px] leading-snug">{r.title}</p>
        <p className="truncate text-xs text-ink-soft">{[kindLabel(r), r.subtitle, r.release_year, r.metadata.album as string | undefined].filter(Boolean).join(" · ")}</p>
        {showOverview && r.metadata.overview && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-faint">{r.metadata.overview}</p>}
      </div>
    </button>
  );
}
