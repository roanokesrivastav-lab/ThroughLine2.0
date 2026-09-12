"use client";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { ConnectionCard } from "@/components/connection-card";
import { PageHeader, CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ConnectionsScreen() {
  const q = useConnections();
  return (
    <div>
      <PageHeader eyebrow="Connections in feeling" title="The lines between things." intro="A film and a song, a novel and a series. These are drawn from how you described each one, never from genre." />
      {q.isPending ? <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div> : q.isError ? <ErrorState message={q.error.message} retry={() => q.refetch()} /> : q.data.connections.length === 0 ? (
        <EmptyState icon={<PenLine className="size-5" />} title="No lines yet" body={q.data.withWords < 2 ? "Connections need your words on at least two things in different categories. A sentence each is enough." : "Nothing crosses over strongly yet. Add words to a few more things."} action={<Button render={<Link href="/history" />}>Open history</Button>} />
      ) : (
        <div className="space-y-3">{q.data.connections.map((c, i) => <ConnectionCard key={`${c.a.id}-${c.b.id}`} c={c} className={cn("rise", i < 4 && `rise-${i + 1}`)} />)}</div>
      )}
    </div>
  );
}
