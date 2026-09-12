import type { Portrait } from "@/lib/taste/portrait";
import { CATEGORY_PLURAL } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The evolving portrait: sentences first, a thin category strip second. Never a chart wall. */
export function PortraitCard({ portrait, className, compact }: { portrait: Portrait; className?: string; compact?: boolean }) {
  return (
    <section className={cn("rounded-2xl bg-paper-2/70 p-5 md:p-6", className)} aria-labelledby="portrait-heading">
      <p className="eyebrow mb-2">Your portrait</p>
      <h2 id="portrait-heading" className={cn("text-balance leading-tight", compact ? "text-2xl" : "text-2xl md:text-3xl")}>{portrait.headline}</h2>
      {portrait.body.length > 0 && <p className="mt-2 text-pretty text-[15px] leading-relaxed text-ink-soft">{portrait.body.join(" ")}</p>}
      {portrait.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Strongest attributes">
          {portrait.tags.map((t) => (
            <li key={t.key} className="rounded-full border border-line bg-paper px-2.5 py-1 text-xs text-ink-soft" style={{ opacity: 0.6 + 0.4 * (t.weight / (portrait.tags[0]?.weight || 1)) }}>{t.label}</li>
          ))}
        </ul>
      )}
      {portrait.categoryMix.length > 0 && (
        <div className="mt-4">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-paper-3" role="img" aria-label={portrait.categoryMix.map((m) => `${CATEGORY_PLURAL[m.category]} ${Math.round(m.share * 100)}%`).join(", ")}>
            {portrait.categoryMix.map((m) => <span key={m.category} className={`cat-${m.category}`} style={{ width: `${m.share * 100}%`, background: "var(--cat)" }} />)}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-faint">
            {portrait.categoryMix.map((m) => <span key={m.category}>{CATEGORY_PLURAL[m.category]} {m.count}</span>)}
          </p>
        </div>
      )}
    </section>
  );
}
