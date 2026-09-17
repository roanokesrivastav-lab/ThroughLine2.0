"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search as SearchIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader, RowSkeleton, EmptyState, ErrorState } from "@/components/states";
import { SearchResultRow } from "@/components/search-results";
import { LogSheet } from "@/components/log-sheet";
import { useSearch, useEntries } from "@/lib/api";
import { EntryRow } from "@/components/entry/entry-row";
import type { CatalogResult } from "@/lib/catalog/types";
import { CATEGORY_PLURAL, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryTabs } from "@/components/category-tabs";
import { ManualAdd } from "@/components/manual-add";

export function AddScreen() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [category, setCategory] = useState<Category | "all">((params.get("category") as Category) ?? "all");
  const [selected, setSelected] = useState<CatalogResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useSearch(debounced, category);
  const recent = useEntries({ status: "in_progress" });

  return (
    <div>
      <PageHeader eyebrow="Add" title="What did you just finish?" intro="Search across film, TV, anime, books and music. Save in one tap; add words when you have them." />
      <div className="sticky top-0 z-10 -mx-4 bg-paper/95 px-4 pb-3 pt-1 backdrop-blur md:static md:mx-0 md:px-0">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, artist, author…" aria-label="Search the catalogue" inputMode="search" enterKeyHint="search"
            className="h-12 rounded-xl border-line bg-card pl-9 pr-9 text-base" />
          {q && <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-faint hover:text-ink"><X className="size-4" /></button>}
        </div>
        <CategoryTabs value={category} onChange={setCategory} className="mt-2" />
      </div>

      <section className="mt-2" aria-live="polite">
        {debounced.trim().length < 2 ? (
          recent.data?.entries.length ? (
            <div className="mt-4">
              <p className="eyebrow mb-2">In progress</p>
              <div className="space-y-1">{recent.data.entries.slice(0, 5).map((e) => <EntryRow key={e.id} entry={e} dense showQuote={false} />)}</div>
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-ink-faint">Start typing. Two letters is enough.</p>
          )
        ) : search.isPending ? (
          <RowSkeleton n={5} />
        ) : search.isError ? (
          <ErrorState message={search.error.message} retry={() => search.refetch()} />
        ) : search.data.results.length === 0 ? (
          <div>
            <EmptyState title="Nothing found" body="Try fewer words, or switch the category. Or add it yourself — web novels and anything else the catalogues miss." />
            <ManualAdd initialTitle={debounced.trim()} initialCategory={category === "all" ? undefined : category} onAdd={setSelected} className="mt-2" />
          </div>
        ) : (
          <div className="space-y-0.5">
            {search.data.degraded.length > 0 && <p className="mb-2 rounded-lg bg-paper-2 px-3 py-2 text-xs text-ink-soft">Showing built-in results for {search.data.degraded.map((c) => CATEGORY_PLURAL[c as Category].toLowerCase()).join(", ")} — the live catalogue was unavailable.</p>}
            {search.data.results.map((r, i) => <SearchResultRow key={`${r.source}:${r.external_id}`} r={r} onSelect={setSelected} className={cn("rise", i < 4 && `rise-${i + 1}`)} />)}
            <ManualAdd key={debounced} initialTitle={debounced.trim()} initialCategory={category === "all" ? undefined : category} onAdd={setSelected} className="mt-3" />
          </div>
        )}
      </section>

      <LogSheet result={selected} open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }} />
    </div>
  );
}
