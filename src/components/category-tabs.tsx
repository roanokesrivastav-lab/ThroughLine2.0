"use client";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Narrow a search to one kind of thing. "Everything" searches all five at once. */
export function CategoryTabs({ value, onChange, className }: { value: Category | "all"; onChange: (c: Category | "all") => void; className?: string }) {
  return (
    <div className={cn("flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]", className)} role="tablist" aria-label="Category">
      {(["all", ...CATEGORIES] as const).map((c) => (
        <button key={c} type="button" role="tab" aria-selected={value === c} onClick={() => onChange(c)}
          className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", value === c ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-soft hover:bg-paper-2")}>
          {c === "all" ? "Everything" : CATEGORY_LABEL[c]}
        </button>
      ))}
    </div>
  );
}
