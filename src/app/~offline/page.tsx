import type { Metadata } from "next";
import { ThreadMark } from "@/components/shell/app-shell";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <ThreadMark className="mb-4 h-8 w-14 text-ink" />
      <h1 className="text-2xl">You are offline.</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-soft">Your library lives in your account, so nothing is lost. Reconnect and this page will come back on its own.</p>
    </main>
  );
}
