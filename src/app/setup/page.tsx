import type { Metadata } from "next";
import { ThreadMark } from "@/components/shell/app-shell";

export const metadata: Metadata = { title: "Setup" };

/** Shown only when the Supabase public env vars are missing. */
export default function SetupPage() {
  return (
    <main className="mx-auto max-w-xl px-5 py-12">
      <ThreadMark className="mb-4 h-8 w-14 text-ink" />
      <h1 className="text-3xl">Almost there.</h1>
      <p className="mt-2 text-sm text-ink-soft">Throughline needs a Supabase project to store your private library. Nothing else is required to try it.</p>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
        <li>Create a free project at supabase.com and open <strong>Project settings → API</strong>.</li>
        <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>.</li>
        <li>Run the migration in <code>supabase/migrations/0001_init.sql</code> (SQL editor, or <code>supabase db push</code>).</li>
        <li>Restart <code>npm run dev</code>. Sign up, then load the demo library from Settings.</li>
      </ol>
      <p className="mt-6 text-xs text-ink-faint">Optional keys (TMDB, Anthropic, NVIDIA, VAPID) unlock full search, AI extraction and push. Without an AI key the app uses a deterministic local fallback.</p>
    </main>
  );
}
