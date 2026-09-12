import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, intro, action, className }: { eyebrow?: string; title: React.ReactNode; intro?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("mb-6 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-balance text-3xl leading-tight md:text-4xl">{title}</h1>
        {intro && <p className="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-ink-soft">{intro}</p>}
      </div>
      {action}
    </header>
  );
}

export function SectionHeader({ eyebrow, title, href, hrefLabel = "See all" }: { eyebrow?: string; title: React.ReactNode; href?: string; hrefLabel?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="text-xl leading-tight">{title}</h2>
      </div>
      {href && <Link href={href} className="text-xs font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline">{hrefLabel}</Link>}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper-2/40 px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-paper-3 text-ink-soft">{icon}</div>}
      <h3 className="text-lg">{title}</h3>
      {body && <p className="mx-auto mt-1 max-w-sm text-pretty text-sm text-ink-soft">{body}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry }: { message?: string; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-6 text-center">
      <h3 className="text-base">Something went wrong</h3>
      <p className="mt-1 text-sm text-ink-soft">{message ?? "Please try again in a moment."}</p>
      {retry && <Button variant="outline" size="sm" className="mt-3" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function RowSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-16 w-12 rounded-md" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-5" aria-busy>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-4/5" />
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className="h-3 w-full" />)}
    </div>
  );
}
