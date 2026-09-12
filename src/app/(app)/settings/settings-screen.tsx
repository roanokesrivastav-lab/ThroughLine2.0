"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Bell, Database, LogOut, Moon, Sparkles, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, CardSkeleton, ErrorState } from "@/components/states";
import { api, useInvalidateLibrary, useProfile } from "@/lib/api";
import { usePushSubscription } from "@/hooks/use-push";
import { TasteTagsEditor } from "@/components/taste-tags-editor";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const listeners = new Set<() => void>();
function subscribeStorage(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("tl-theme", cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("tl-theme", cb); window.removeEventListener("storage", cb); };
}
function readTheme(): "system" | "light" | "dark" {
  try { return (localStorage.getItem("tl-theme") as "light" | "dark" | null) ?? "system"; } catch { return "system"; }
}

const CADENCES = [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["monthly", "Monthly"], ["off", "Off"]] as const;

export function SettingsScreen() {
  const router = useRouter();
  const profile = useProfile();
  const push = usePushSubscription();
  const invalidate = useInvalidateLibrary();
  const theme = useSyncExternalStore(subscribeStorage, readTheme, () => "system" as const);

  const prefs = useMutation({ mutationFn: (p: Record<string, unknown>) => api("/api/settings", { method: "PATCH", json: { notificationPrefs: p } }), onSuccess: () => profile.refetch() });
  const seed = useMutation({ mutationFn: () => api<{ created: number }>("/api/demo/seed", { method: "POST" }), onSuccess: () => { invalidate(); router.push("/"); } });
  const signOut = async () => { await supabaseBrowser().auth.signOut(); router.push("/auth/sign-in"); router.refresh(); };

  const applyTheme = (t: "system" | "light" | "dark") => {
    try { if (t === "system") localStorage.removeItem("tl-theme"); else localStorage.setItem("tl-theme", t); } catch { /* ignore */ }
    window.dispatchEvent(new Event("tl-theme"));
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  };

  if (profile.isPending) return <div className="space-y-4"><CardSkeleton /><CardSkeleton /></div>;
  if (profile.isError) return <ErrorState message={profile.error.message} retry={() => profile.refetch()} />;
  const p = profile.data;
  const snoozed = p.notificationPrefs.snoozed_until && new Date(p.notificationPrefs.snoozed_until) > new Date();

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Quiet controls." intro={p.email ?? undefined} />
      <div className="space-y-5">
        <section className="rounded-2xl border border-line bg-card p-5" aria-labelledby="notif">
          <h2 id="notif" className="flex items-center gap-2 text-lg"><Bell className="size-4 text-ink-soft" aria-hidden /> Resurfacing</h2>
          <p className="mt-1 text-sm text-ink-soft">One card, one question. Never more than one reminder per cadence, never while one is waiting.</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <label htmlFor="push" className="text-sm">Push reminders</label>
            {push.supported && push.configured ? (
              <Switch id="push" checked={push.subscribed} disabled={push.busy} onCheckedChange={(v) => (v ? push.subscribe() : push.unsubscribe())} />
            ) : <span className="text-xs text-ink-faint">{push.supported ? "Not configured on this deployment" : "Unsupported in this browser"}</span>}
          </div>
          {push.error && <p className="mt-1 text-xs text-destructive">{push.error}</p>}
          <div className="mt-4">
            <p className="mb-1.5 text-sm">Cadence</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cadence">
              {CADENCES.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={p.notificationPrefs.cadence === v} onClick={() => prefs.mutate({ cadence: v })} className={cn("rounded-full border px-3 py-1 text-xs", p.notificationPrefs.cadence === v ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{l}</button>)}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {snoozed ? (
              <><span className="text-xs text-ink-soft">Snoozed until {new Date(p.notificationPrefs.snoozed_until!).toLocaleDateString()}.</span><Button size="sm" variant="outline" onClick={() => prefs.mutate({ snoozed_until: null })}>Unsnooze</Button></>
            ) : (
              <><Button size="sm" variant="outline" onClick={() => prefs.mutate({ snoozed_until: new Date(Date.now() + 30 * 86_400_000).toISOString() })}>Snooze a month</Button><Button size="sm" variant="ghost" onClick={() => prefs.mutate({ snoozed_until: new Date(Date.now() + 90 * 86_400_000).toISOString() })}>Snooze three months</Button></>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-card p-5" aria-labelledby="appearance">
          <h2 id="appearance" className="flex items-center gap-2 text-lg"><Sun className="size-4 text-ink-soft" aria-hidden /> Appearance</h2>
          <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Theme">
            {(["system", "light", "dark"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => applyTheme(t)} className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs capitalize", theme === t ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{t === "dark" ? <Moon className="size-3" /> : t === "light" ? <Sun className="size-3" /> : null}{t}</button>)}
          </div>
        </section>

        <TasteTagsEditor />

        <section className="rounded-2xl border border-line bg-card p-5" aria-labelledby="engine">
          <h2 id="engine" className="flex items-center gap-2 text-lg"><Sparkles className="size-4 text-ink-soft" aria-hidden /> How this works</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-faint">Reading your words</dt><dd>{p.capabilities.ai === "claude" ? "Claude, server-side only. Your raw notes are never rewritten." : "Built-in lexicon (no AI key configured). Deterministic and private."}</dd>
            <dt className="text-ink-faint">Film, TV, anime</dt><dd>{p.capabilities.tmdb ? "TMDB search" : "Built-in list only — add a TMDB key for full search"}</dd>
            <dt className="text-ink-faint">Books</dt><dd>Open Library</dd>
            <dt className="text-ink-faint">Music</dt><dd>MusicBrainz</dd>
            <dt className="text-ink-faint">Sharing</dt><dd>None. Nothing you log leaves your account.</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" render={<Link href="/onboarding" />}>Revisit the opening</Button>
          </div>
        </section>

        <section className="rounded-2xl border border-dashed border-line bg-paper-2/40 p-5" aria-labelledby="demo">
          <h2 id="demo" className="flex items-center gap-2 text-lg"><Database className="size-4 text-ink-soft" aria-hidden /> Demo library</h2>
          <p className="mt-1 text-sm text-ink-soft">Load about forty entries with notes across all five categories, spanning twenty months, so you can see connections, phases and the taste portrait immediately. Adds to your account; you can remove entries afterwards.</p>
          <Button size="sm" className="mt-3" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>{seed.isPending ? "Loading… this takes a few seconds" : p.entryCount > 0 ? "Add demo library" : "Load demo library"}</Button>
          {seed.isError && <p className="mt-2 text-xs text-destructive">{seed.error.message}</p>}
        </section>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={signOut}><LogOut className="size-4" data-icon="inline-start" /> Sign out</Button>
          <p className="self-center text-xs text-ink-faint">{p.entryCount} entries</p>
        </div>
      </div>
    </div>
  );
}
