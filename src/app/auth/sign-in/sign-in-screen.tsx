"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThreadMark } from "@/components/shell/app-shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { signInDestination, signInError } from "@/lib/auth/sign-in";

export function SignInScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = signInDestination(params.get("next"));
  const [mode, setMode] = useState<"in" | "up" | "link">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(params.get("error") === "link" ? { kind: "error", text: "That sign-in link could not be used. Request a fresh link and open it in the same browser." } : null);

  // TEMPORARY: skips the confirmation email while delivery is broken. Development only.
  const devBypass = process.env.NODE_ENV !== "production";
  const confirmInDev = async () => {
    const res = await fetch("/api/dev/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not skip verification");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const supabase = supabaseBrowser();
      if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Check your email for a sign-in link." });
      } else if (mode === "up") {
        if (devBypass) {
          // Create the account already confirmed, then sign straight in.
          await confirmInDev();
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          router.push("/onboarding"); router.refresh();
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
        if (error) throw error;
        if (data.session) { router.push("/onboarding"); router.refresh(); }
        else setMsg({ kind: "ok", text: "Account created. Check your email to confirm, then sign in." });
      } else {
        let { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error && devBypass && /confirm/i.test(error.message)) {
          // The address is unconfirmed and the email never arrives; confirm it here and retry.
          await confirmInDev();
          ({ error } = await supabase.auth.signInWithPassword({ email, password }));
        }
        if (error) throw error;
        router.push(next); router.refresh();
      }
    } catch (err) {
      setMsg({ kind: "error", text: signInError(err) });
    } finally { setBusy(false); }
  };

  const signInLocally = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/dev/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not sign in locally.");
      // Reload so browser auth and server-rendered screens both see the new cookies.
      window.location.assign(next);
    } catch (error) { setMsg({ kind: "error", text: signInError(error) }); }
    finally { setBusy(false); }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <ThreadMark className="mx-auto mb-3 h-8 w-14 text-ink" />
          <h1 className="text-3xl">Throughline</h1>
          <p className="mt-2 text-pretty text-sm text-ink-soft">A private mirror for your taste. No feed, no followers, nothing public.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-card p-5">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 bg-paper text-base" />
          </div>
          {mode !== "link" && (
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 bg-paper text-base" />
            </div>
          )}
          {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "text-sm text-destructive" : "text-sm text-ink-soft"}>{msg.text}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "One moment…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Email me a link"}</Button>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
            {mode !== "in" && <button type="button" className="underline-offset-4 hover:underline" onClick={() => setMode("in")}>Sign in with password</button>}
            {mode !== "up" && <button type="button" className="underline-offset-4 hover:underline" onClick={() => setMode("up")}>Create an account</button>}
            {mode !== "link" && <button type="button" className="underline-offset-4 hover:underline" onClick={() => setMode("link")}>Use a magic link</button>}
          </div>
          {devBypass && mode !== "link" && (
            <div className="space-y-2">
              <Button type="button" variant="outline" className="w-full" disabled={busy || !email.trim()} onClick={signInLocally}>Sign in locally</Button>
              <p className="text-xs text-ink-soft">Local sign-in uses the account configured for development. Your password stays unchanged.</p>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
