"use client";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import type { CatalogResult } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export function SearchResultRow({ r, onSelect, className }: { r: CatalogResult; onSelect: (r: CatalogResult) => void; className?: string }) {
  return (
    <button type="button" onClick={() => onSelect(r)} className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-paper-2/70 focus-visible:outline-2 focus-visible:outline-ring", className)}>
      <MediaArt title={r.title} category={r.category} image={r.image_url} size="sm" />
      <div className="min-w-0 flex-1">
        <CategoryChip category={r.category} />
        <p className="truncate text-[15px] leading-snug">{r.title}</p>
        <p className="truncate text-xs text-ink-soft">{[r.subtitle, r.release_year, r.metadata.album as string | undefined].filter(Boolean).join(" · ")}</p>
      </div>
    </button>
  );
}
