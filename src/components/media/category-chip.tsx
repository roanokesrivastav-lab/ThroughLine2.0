import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

export function CategoryChip({ category, className }: { category: Category; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft", `cat-${category}`, className)}>
      <span className="size-1.5 rounded-full" style={{ background: "var(--cat)" }} aria-hidden />
      {CATEGORY_LABEL[category]}
    </span>
  );
}
