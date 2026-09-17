"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MediaArt } from "@/components/media/media-art";
import { PhaseChip } from "@/components/phase-chip";
import { WhenPicker } from "@/components/when-picker";
import { EmptyState, ErrorState, PageHeader, RowSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useEntries, usePhases, useUpdateEntry } from "@/lib/api";
import type { EntryDTO } from "@/lib/server/dto";
import type { PhaseWithMembers } from "@/lib/server/phases";
import { seasonBounds, seasonOf, spanOf, type Season, type When } from "@/lib/taste/when";
import { cn } from "@/lib/utils";

type Zoom = "years" | "seasons";
type Band = { key: string; label: string; href: string; from: string; to: string; items: EntryDTO[] };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SEASON_ORDER: Record<Season, number> = { winter: 0, spring: 1, summer: 2, autumn: 3 };

/** Which band an entry sits in. Vague dates never get pulled into a season they were not given. */
function bandOf(e: EntryDTO, zoom: Zoom): Omit<Band, "items"> {
  const w = e.when!;
  const midYear = Number(w.mid.slice(0, 4));
  if (zoom === "seasons" && (w.precision === "day" || w.precision === "month" || w.precision === "season")) {
    const s = seasonOf(new Date(`${w.mid}T00:00:00Z`));
    const b = seasonBounds(s.year, s.season);
    return { key: `${s.year}-${SEASON_ORDER[s.season]}`, label: `${cap(s.season)} ${s.year}`, href: `/history/${s.year}-${s.season}`, from: b.from, to: b.to };
  }
  const label = zoom === "seasons" ? `Sometime in ${midYear}` : String(midYear);
  // "--" sorts a year's vague band after its seasons when newest comes first.
  return { key: zoom === "seasons" ? `${midYear}--` : `${midYear}`, label, href: `/history/${midYear}`, from: `${midYear}-01-01`, to: `${midYear}-12-31` };
}

/**
 * A walk back through time: one band per year (or season), newest first, showing what you were
 * into then and the phases noticed there. No counts, no streaks, no charts.
 */
export function TimelineScreen() {
  const entries = useEntries({});
  const phases = usePhases();
  const [zoom, setZoom] = useState<Zoom>("years");

  const { bands, undated } = useMemo(() => {
    const list = (entries.data?.entries ?? []).filter((e) => e.status !== "want");
    const map = new Map<string, Band>();
    for (const e of list) {
      if (!e.when) continue;
      const b = bandOf(e, zoom);
      const cur = map.get(b.key) ?? { ...b, items: [] };
      cur.items.push(e);
      map.set(b.key, cur);
    }
    for (const b of map.values()) b.items.sort((x, y) => y.affinity - x.affinity);
    return {
      bands: [...map.values()].sort((a, b) => b.key.localeCompare(a.key)),
      undated: list.filter((e) => !e.when),
    };
  }, [entries.data, zoom]);

  const activePhases = (phases.data?.phases ?? []).filter((p) => !p.dismissed);

  if (entries.isPending) return <div><Header zoom={zoom} setZoom={setZoom} /><RowSkeleton n={5} /></div>;
  if (entries.isError) return <ErrorState message={entries.error.message} retry={() => entries.refetch()} />;

  return (
    <div>
      <Header zoom={zoom} setZoom={setZoom} />

      {bands.length === 0 && undated.length === 0 ? (
        <EmptyState title="Nothing on the timeline yet" body="Add a few things you have loved and say roughly when. The timeline fills in from there."
          action={<Button render={<Link href="/add" />}>Add something</Button>} />
      ) : (
        <ol className="relative space-y-8 border-l border-line pl-5">
          {bands.map((band, i) => {
            const prev = bands[i - 1];
            const gap = prev ? Number(prev.from.slice(0, 4)) - Number(band.to.slice(0, 4)) - 1 : 0;
            return (
              <li key={band.key} className="relative">
                {gap >= 1 && <p className="-mt-4 mb-4 text-[11px] text-ink-faint">{gap === 1 ? "Nothing dated the year before" : `Nothing dated for ${gap} years`}</p>}
                <span className="absolute -left-[26px] top-2 size-2.5 rounded-full border-2 border-paper bg-ember" aria-hidden />
                <BandView band={band} phases={activePhases} />
              </li>
            );
          })}
        </ol>
      )}

      {undated.length > 0 && <UndatedShelf entries={undated} />}
    </div>
  );
}

function Header({ zoom, setZoom }: { zoom: Zoom; setZoom: (z: Zoom) => void }) {
  return (
    <PageHeader eyebrow="Timeline" title="Back through time." intro="What you were into, and when. Tap a year to open that era."
      action={
        <div className="flex shrink-0 rounded-full border border-line bg-card p-0.5 text-xs" role="tablist" aria-label="Zoom">
          {(["years", "seasons"] as Zoom[]).map((z) => (
            <button key={z} type="button" role="tab" aria-selected={zoom === z} onClick={() => setZoom(z)}
              className={cn("rounded-full px-2.5 py-1 font-medium", zoom === z ? "bg-ink text-paper" : "text-ink-soft hover:text-ink")}>{cap(z)}</button>
          ))}
        </div>
      } />
  );
}

function BandView({ band, phases }: { band: Band; phases: PhaseWithMembers[] }) {
  const overlapping = phases.filter((p) => p.start_at <= band.to && p.end_at >= band.from);
  return (
    <section aria-labelledby={`band-${band.key}`}>
      <h2 id={`band-${band.key}`} className="text-2xl leading-tight">
        <Link href={band.href} className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{band.label}</Link>
      </h2>
      {overlapping.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{overlapping.slice(0, 4).map((p) => <PhaseChip key={p.id} phase={p} />)}</div>
      )}
      <ul className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {band.items.map((e) => (
          <li key={e.id} className="w-20 shrink-0">
            <Link href={`/entry/${e.id}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
              <MediaArt title={e.item.title} category={e.item.category} image={e.item.image_url} size="md" className="h-28 w-20" />
              <p className="mt-1 line-clamp-2 text-xs leading-snug">{e.item.title}</p>
              {e.when && e.when.precision !== "day" && e.when.precision !== "month" && e.when.label !== band.label && <p className="text-[10px] text-ink-faint">{e.when.label}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Things with no date yet, each datable in place. */
function UndatedShelf({ entries }: { entries: EntryDTO[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<When | null>(null);
  const update = useUpdateEntry();
  const draftLabel = draft ? spanOf(draft)?.label : null;
  return (
    <section id="undated" className="mt-10 rounded-2xl border border-dashed border-line bg-paper-2/40 p-4" aria-labelledby="undated-h">
      <h2 id="undated-h" className="text-lg">Not on the timeline yet</h2>
      <p className="mt-1 text-sm text-ink-soft">Say roughly when, and each one finds its place. A year, a season, or &ldquo;as a teen&rdquo; is plenty.</p>
      <ul className="mt-3 divide-y divide-line">
        {entries.map((e) => (
          <li key={e.id} className="py-2">
            <button type="button" onClick={() => { setOpen(open === e.id ? null : e.id); setDraft(null); }} aria-expanded={open === e.id}
              className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring">
              <MediaArt title={e.item.title} category={e.item.category} image={e.item.image_url} size="xs" />
              <span className="min-w-0 flex-1 truncate text-[15px]">{e.item.title}</span>
              <span className="flex items-center gap-1 text-xs text-ink-faint">When? <ChevronDown className={cn("size-3.5 transition-transform", open === e.id && "rotate-180")} aria-hidden /></span>
            </button>
            {open === e.id && (
              <div className="mt-3 pl-12">
                {/* Held as a draft so choosing "Pick a year" does not whisk the row away before a year is chosen. */}
                <WhenPicker allowNow={false} onChange={setDraft} />
                <Button size="sm" className="mt-3" disabled={!draft?.consumed_at || update.isPending}
                  onClick={() => { if (draft?.consumed_at) update.mutate({ id: e.id, ...draft }, { onSuccess: () => { setOpen(null); setDraft(null); } }); }}>
                  {draftLabel ? `Place it in ${draftLabel.replace("~", "")}` : "Place it"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

