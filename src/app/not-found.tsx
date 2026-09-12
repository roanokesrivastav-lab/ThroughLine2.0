import Link from "next/link";
import { ThreadMark } from "@/components/shell/app-shell";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <ThreadMark className="mb-4 h-8 w-14 text-ink" />
      <h1 className="text-2xl">Nothing here.</h1>
      <p className="mt-2 text-sm text-ink-soft">That thread does not lead anywhere.</p>
      <Link href="/" className="mt-4 text-sm underline underline-offset-4">Back to the mirror</Link>
    </main>
  );
}
