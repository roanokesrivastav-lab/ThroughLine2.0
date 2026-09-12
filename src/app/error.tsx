"use client";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl">Something broke.</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">{error.message || "An unexpected error."}</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </main>
  );
}
