"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, History, Home, Plus, Sparkles, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Mirror", icon: Home, match: (p: string) => p === "/" || p.startsWith("/connections") || p.startsWith("/resurface") },
  { href: "/history", label: "History", icon: History, match: (p: string) => p.startsWith("/history") || p.startsWith("/entry") },
  { href: "/add", label: "Add", icon: Plus, match: (p: string) => p.startsWith("/add") || p.startsWith("/search"), primary: true },
  { href: "/taste", label: "Taste", icon: Sparkles, match: (p: string) => p.startsWith("/taste") },
  { href: "/recommend", label: "Find", icon: Compass, match: (p: string) => p.startsWith("/recommend") },
];

export function AppShell({ children, hideNav = false }: { children: React.ReactNode; hideNav?: boolean }) {
  const pathname = usePathname();
  const bare = hideNav || pathname.startsWith("/onboarding");
  return (
    <div className="flex min-h-dvh w-full flex-col md:flex-row">
      {!bare && (
        <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-56 md:flex-col md:border-r md:border-line md:bg-paper-2/60 md:px-4 md:py-6">
          <Link href="/" className="mb-8 flex items-center gap-2 px-2">
            <ThreadMark />
            <span className="font-serif text-xl">Throughline</span>
          </Link>
          <nav className="flex flex-col gap-1" aria-label="Primary">
            {NAV.map((n) => {
              const active = n.match(pathname);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", active ? "bg-paper-3 text-ink" : "text-ink-soft hover:bg-paper-3/60 hover:text-ink")}>
                  <n.icon className="size-4" aria-hidden />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto">
            <Link href="/settings" className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-3/60 hover:text-ink", pathname.startsWith("/settings") && "bg-paper-3 text-ink")}>
              <Settings className="size-4" aria-hidden /> Settings
            </Link>
            <p className="mt-3 px-3 text-[11px] leading-relaxed text-ink-faint">Private by default. Nothing here is shared.</p>
          </div>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className={cn("mx-auto w-full max-w-2xl flex-1 px-4 pt-4 md:px-8 md:pt-8", bare ? "pb-8" : "pb-28 md:pb-12")}>{children}</main>
        {!bare && (
          <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/90 backdrop-blur safe-bottom md:hidden">
            <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1">
              {NAV.map((n) => {
                const active = n.match(pathname);
                return (
                  <li key={n.href} className="flex justify-center">
                    <Link href={n.href} aria-current={active ? "page" : undefined} aria-label={n.label}
                      className={cn("flex min-w-14 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        n.primary ? "-mt-4" : "", active ? "text-ink" : "text-ink-faint hover:text-ink-soft")}>
                      {n.primary ? (
                        <span className={cn("flex size-12 items-center justify-center rounded-full bg-ink text-paper shadow-md transition-transform active:scale-95", active && "ring-4 ring-ember/25")}>
                          <n.icon className="size-6" aria-hidden />
                        </span>
                      ) : (
                        <n.icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden />
                      )}
                      <span className={cn(n.primary && "sr-only")}>{n.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}

export function ThreadMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 24" className={cn("h-5 w-8", className)} aria-hidden>
      <path d="M3 14 C 10 4, 16 20, 22 12 S 32 6, 37 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="3" cy="14" r="2.4" fill="var(--ember)" />
      <circle cx="13" cy="10" r="2.4" fill="var(--ember)" />
      <circle cx="22" cy="12" r="2.4" fill="var(--ember)" />
      <circle cx="30" cy="8" r="2.4" fill="var(--ember)" />
      <circle cx="37" cy="10" r="2.4" fill="var(--ember)" />
    </svg>
  );
}
