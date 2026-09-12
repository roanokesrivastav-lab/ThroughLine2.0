"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";

const SIZES = { xs: "size-9 rounded-md text-[9px]", sm: "h-16 w-12 rounded-md text-[10px]", md: "h-24 w-16 rounded-lg text-xs", lg: "h-40 w-28 rounded-xl text-sm", xl: "h-56 w-40 rounded-2xl text-base" };

/** Cover art when available; otherwise a quiet typographic tile in the category hue. Imagery never shouts. */
export function MediaArt({ title, category, image, size = "md", className, square }: { title: string; category: Category; image?: string | null; size?: keyof typeof SIZES; className?: string; square?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initials = title.replace(/^(the|a|an)\s+/i, "").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-paper-3", `cat-${category}`, SIZES[size], square && "aspect-square h-auto", className)} aria-hidden>
      {image && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col items-start justify-end p-1.5" style={{ background: "linear-gradient(160deg, color-mix(in oklch, var(--cat) 18%, var(--paper-3)), color-mix(in oklch, var(--cat) 42%, var(--paper-3)))" }}>
          <span className="font-serif leading-none tracking-tight" style={{ color: "color-mix(in oklch, var(--cat) 80%, var(--ink))" }}>{initials}</span>
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: "var(--cat)" }} />
    </div>
  );
}
