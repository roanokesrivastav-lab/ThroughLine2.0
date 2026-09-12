"use client";
import Link from "next/link";
import { confidenceLabel } from "@/lib/taste/phases";
import type { PhaseWithMembers } from "@/lib/server/phases";
import { CATEGORY_PLURAL } from "@/lib/types";
import { cn } from "@/lib/utils";

const CONF_STYLE = { tentative: "border-dashed text-ink-faint", likely: "text-ink-soft", strong: "text-ink border-ink/40" };

/** A detected phase, shown as what it is: an inference with a confidence, never a fact. */
export function PhaseChip({ phase, className, link = true }: { phase: PhaseWithMembers; className?: string; link?: boolean }) {
  const conf = confidenceLabel(phase.confidence);
  const inner = (
    <span className={cn("inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs", CONF_STYLE[conf], phase.category && `cat-${phase.category}`, className)}>
      {phase.category ? <span className="size-1.5 rounded-full" style={{ background: "var(--cat)" }} aria-hidden /> : <span className="size-1.5 rounded-full bg-[conic-gradient(var(--cat-movie),var(--cat-tv),var(--cat-book),var(--cat-music),var(--cat-anime),var(--cat-movie))]" aria-hidden />}
      <span className="font-medium">{phase.user_label ?? phase.label}</span>
      <span className="text-[10px] uppercase tracking-wider text-ink-faint">{conf} · {phase.entryIds.length}</span>
      <span className="sr-only">{phase.category ? CATEGORY_PLURAL[phase.category] : "Cross-media"}</span>
    </span>
  );
  return link ? <Link href={`/history/phase-${phase.id}`} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">{inner}</Link> : inner;
}
