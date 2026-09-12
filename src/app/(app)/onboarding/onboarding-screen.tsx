"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, Check, Eye, EyeOff, Heart, Search as SearchIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaArt } from "@/components/media/media-art";
import { CategoryChip } from "@/components/media/category-chip";
import { SearchResultRow } from "@/components/search-results";
import { PortraitCard } from "@/components/portrait-card";
import { RowSkeleton } from "@/components/states";
import { ThreadMark } from "@/components/shell/app-shell";
import { api, keys, useCanonDeck, useCreateEntry, useHome, useInvalidateLibrary, useProfile, useSearch } from "@/lib/api";
import { usePushSubscription } from "@/hooks/use-push";
import type { CatalogResult } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

type Stage = "picks" | "canon" | "portrait";

/** Onboarding is the first resurfacing session: pick what you love, then react to a rapid canon pass. */
export function OnboardingScreen() {
  const router = useRouter();
  const profile = useProfile();
  const [stage, setStage] = useState<Stage>("picks");
  const canonPrefs = (profile.data?.onboardingPrefs?.canon as Record<string, string> | undefined) ?? {};
  const alreadyReacted = Object.keys(canonPrefs).length;

  return (
    <div className="mx-auto max-w-lg">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2"><ThreadMark /><span className="font-serif text-lg">Throughline</span></Link>
        <div className="flex items-center gap-1" aria-label={`Step ${stage === "picks" ? 1 : stage === "canon" ? 2 : 3} of 3`}>
          {(["picks", "canon", "portrait"] as Stage[]).map((s) => <span key={s} className={cn("h-1 w-6 rounded-full", s === stage ? "bg-ink" : "bg-paper-3")} />)}
        </div>
      </header>
      {stage === "picks" && <Picks onNext={() => setStage("canon")} />}
      {stage === "canon" && <Canon onDone={() => setStage("portrait")} onBack={() => setStage("picks")} skipHint={alreadyReacted > 0} />}
      {stage === "portrait" && <FirstPortrait onFinish={() => router.push("/")} />}
    </div>
  );
}

/* ---------- Stage one: up to ten things you have loved ---------- */
function Picks({ onNext }: { onNext: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<CatalogResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateEntry();
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const search = useSearch(debounced, "all");
  const pickedKeys = useMemo(() => new Set(picked.map((p) => `${p.source}:${p.external_id}`)), [picked]);

  const add = (r: CatalogResult) => {
    if (picked.length >= 10 || pickedKeys.has(`${r.source}:${r.external_id}`)) return;
    setPicked((p) => [...p, r]);
    setQ(""); setDebounced("");
    inputRef.current?.focus();
    create.mutate({ result: r, status: "completed", dimensions: { loved: true }, origin: "onboarding_pick" });
  };

  return (
    <section className="rise">
      <p className="eyebrow mb-1">One of three</p>
      <h1 className="text-balance text-3xl leading-tight md:text-4xl">Name a few things you have loved.</h1>
      <p className="mt-2 text-pretty text-[15px] text-ink-soft">Any category, any era, up to ten. No need to explain yet — you can add words later, and words are what make this work.</p>

      <div className="relative mt-5">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="A film, a song, a book, a series…" aria-label="Search" disabled={picked.length >= 10} className="h-12 rounded-xl border-line bg-card pl-9 text-base" autoFocus />
      </div>

      <div className="mt-2 min-h-24" aria-live="polite">
        {debounced.length >= 2 && (search.isPending ? <RowSkeleton n={3} /> : search.data?.results.length ? (
          <div className="space-y-0.5">{search.data.results.slice(0, 8).map((r) => <SearchResultRow key={`${r.source}:${r.external_id}`} r={r} onSelect={add} className={cn(pickedKeys.has(`${r.source}:${r.external_id}`) && "opacity-40")} />)}</div>
        ) : <p className="px-2 py-4 text-sm text-ink-faint">Nothing found. Try another spelling.</p>)}
      </div>

      {picked.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Your picks">
          {picked.map((p) => (
            <li key={`${p.source}:${p.external_id}`} className="rise flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3 text-sm">
              <MediaArt title={p.title} category={p.category} image={p.image_url} size="xs" />
              <span className="max-w-40 truncate">{p.title}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-ink-faint">{picked.length} of 10</p>
        <Button size="lg" onClick={onNext}>{picked.length ? "Continue" : "Skip for now"} <ArrowRight className="size-4" data-icon="inline-end" /></Button>
      </div>
    </section>
  );
}

/* ---------- Stage two: rapid canon pass ---------- */
function Canon({ onDone, onBack, skipHint }: { onDone: () => void; onBack: () => void; skipHint: boolean }) {
  const deck = useCanonDeck();
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState({ loved: 0, seen: 0, never: 0 });
  const qc = useQueryClient();
  const react = useMutation({
    mutationFn: (body: { result: CatalogResult; response: "loved" | "seen" | "never" }) => api<{ ok: true }>("/api/onboarding", { method: "POST", json: body }),
  });
  const cards = deck.data?.cards ?? [];
  const card = cards[index];
  const total = cards.length;

  const answer = (response: "loved" | "seen" | "never") => {
    if (!card) return;
    react.mutate({ result: card, response });
    setTally((t) => ({ ...t, [response]: t[response] + 1 }));
    if (index + 1 >= total) finish(); else setIndex(index + 1);
  };
  const finish = () => { qc.invalidateQueries({ queryKey: keys.home }); qc.invalidateQueries({ queryKey: keys.canon }); onDone(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "1") answer("loved"); if (e.key === "2") answer("seen"); if (e.key === "3") answer("never"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, index]);

  return (
    <section className="rise">
      <p className="eyebrow mb-1">Two of three</p>
      <h1 className="text-balance text-3xl leading-tight md:text-4xl">A quick pass through things you may have met.</h1>
      <p className="mt-2 text-pretty text-[15px] text-ink-soft">Tap fast, go with your gut. Nothing here is a recommendation and none of it is ranked — it is only a guess at what you have crossed paths with.</p>

      <div className="mt-6" aria-live="polite">
        {deck.isPending ? (
          <div className="h-72 animate-pulse rounded-3xl bg-paper-2" />
        ) : !card ? (
          <div className="rounded-3xl bg-paper-2 p-8 text-center">
            <p className="text-lg">{skipHint ? "You have been through the deck." : "That is the deck."}</p>
            <Button className="mt-4" onClick={finish}>See your first portrait</Button>
          </div>
        ) : (
          <div key={`${card.source}:${card.external_id}`} className="rise">
            <div className="flex items-center justify-between text-xs text-ink-faint"><span>{index + 1} of {total}</span><span>{tally.loved} loved · {tally.seen} seen</span></div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-3" aria-hidden><div className="h-full bg-ink transition-[width]" style={{ width: `${((index) / Math.max(total, 1)) * 100}%` }} /></div>
            <article className={cn("mt-4 overflow-hidden rounded-3xl border border-line bg-card", `cat-${card.category}`)}>
              <div className="flex gap-5 p-5">
                <MediaArt title={card.title} category={card.category} image={card.image_url} size="xl" />
                <div className="min-w-0 flex-1 self-center">
                  <CategoryChip category={card.category} />
                  <h2 className="mt-2 text-balance text-2xl leading-tight md:text-3xl">{card.title}</h2>
                  <p className="mt-1 text-sm text-ink-soft">{[card.subtitle, card.release_year].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 border-t border-line">
                <CanonTap icon={<Heart className="size-5" />} label="Loved it" hint="1" onClick={() => answer("loved")} tone="ember" />
                <CanonTap icon={<Eye className="size-5" />} label="Seen it" hint="2" onClick={() => answer("seen")} />
                <CanonTap icon={<EyeOff className="size-5" />} label="Never heard of it" hint="3" onClick={() => answer("never")} />
              </div>
            </article>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button variant="outline" onClick={finish}>Stop here</Button>
      </div>
    </section>
  );
}

function CanonTap({ icon, label, hint, onClick, tone }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; tone?: "ember" }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-20 flex-col items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring active:bg-paper-2", tone === "ember" ? "text-ember hover:bg-ember-soft/50" : "text-ink-soft hover:bg-paper-2")}>
      <span aria-hidden>{icon}</span>{label}<kbd className="hidden text-[10px] text-ink-faint md:block">{hint}</kbd>
    </button>
  );
}

/* ---------- Stage three: first portrait + push opt-in ---------- */
function FirstPortrait({ onFinish }: { onFinish: () => void }) {
  const home = useHome();
  const push = usePushSubscription();
  const invalidate = useInvalidateLibrary();
  const complete = useMutation({
    mutationFn: () => api("/api/settings", { method: "PATCH", json: { onboardingCompleted: true } }),
    onSuccess: () => { invalidate(); onFinish(); },
  });
  const refetch = home.refetch;
  useEffect(() => { const t = setTimeout(() => refetch(), 1500); return () => clearTimeout(t); }, [refetch]);

  return (
    <section className="rise">
      <p className="eyebrow mb-1">Three of three</p>
      <h1 className="text-balance text-3xl leading-tight md:text-4xl">A first sketch.</h1>
      <p className="mt-2 text-pretty text-[15px] text-ink-soft">This is a rough outline from a few taps. It sharpens the moment you write a line about something.</p>
      <div className="mt-5">
        {home.isPending ? <div className="h-40 animate-pulse rounded-2xl bg-paper-2" /> : home.data ? <PortraitCard portrait={home.data.portrait} compact /> : null}
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-card p-5">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden />
          <div className="flex-1">
            <h2 className="text-lg">Once a week, one question.</h2>
            <p className="mt-1 text-sm text-ink-soft">Throughline can bring back one thing from your history and ask if it still hits. One tap. Never more than once a week, and you can snooze or switch it off any time.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {push.supported && push.configured ? (
                push.subscribed ? <p className="flex items-center gap-1.5 text-sm text-ink"><Check className="size-4 text-ember" /> Weekly reminders on</p>
                : <Button variant="outline" onClick={() => push.subscribe()} disabled={push.busy}>{push.busy ? "Asking…" : "Turn on weekly reminder"}</Button>
              ) : (
                <p className="text-xs text-ink-faint">{push.supported ? "Push is not configured on this deployment. You can still find your weekly card on the Mirror." : "This browser does not support push. Your weekly card will still wait on the Mirror."}</p>
              )}
              {push.error && <p className="text-xs text-destructive">{push.error}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button size="lg" onClick={() => complete.mutate()} disabled={complete.isPending}>Go to your mirror <ArrowRight className="size-4" data-icon="inline-end" /></Button>
      </div>
      <p className="mt-3 flex items-center gap-1 text-xs text-ink-faint"><X className="size-3" /> You can come back to this any time from Settings.</p>
    </section>
  );
}
