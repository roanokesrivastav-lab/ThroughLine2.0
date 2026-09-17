"use client";
import { useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogResult } from "@/lib/catalog/types";
import { BOOK_KINDS, BOOK_KIND_LABEL, CATEGORIES, CATEGORY_LABEL, type BookKind, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

const BY_LABEL: Record<Category, string> = { movie: "Director", tv: "Creator", anime: "Studio or creator", book: "Author", music: "Artist" };

/**
 * For things no catalogue has: web novels, obscure albums, a zine. The user types what it is and
 * which kind of thing it is. The server keys it to them alone and claims nothing else about it.
 */
export function ManualAdd({ initialTitle = "", initialCategory, onAdd, className }: { initialTitle?: string; initialCategory?: Category; onAdd: (r: CatalogResult) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [by, setBy] = useState("");
  const [category, setCategory] = useState<Category>(initialCategory ?? "book");
  const [kind, setKind] = useState<BookKind>("web_novel");

  if (!open) {
    return (
      <button type="button" onClick={() => { setTitle(initialTitle); if (initialCategory) setCategory(initialCategory); setOpen(true); }}
        className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring", className)}>
        <PenLine className="size-3.5" aria-hidden /> Can&apos;t find it? Add it yourself
      </button>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    onAdd({
      category, title: t, subtitle: by.trim() || null, source: "manual", external_id: t, // the server replaces this id
      image_url: null, release_year: null, creators: [], genre_tags: [],
      metadata: category === "book" ? { book_kind: kind } : {},
    });
    setOpen(false); setTitle(""); setBy("");
  };

  return (
    <form onSubmit={submit} className={cn("rise space-y-3 rounded-2xl border border-line bg-card p-4", className)}>
      <p className="text-sm text-ink-soft">Add something the search doesn&apos;t have. Only you will see it.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="bg-paper" maxLength={300} autoFocus />
        <Input value={by} onChange={(e) => setBy(e.target.value)} placeholder={`${BY_LABEL[category]} (optional)`} aria-label={BY_LABEL[category]} className="bg-paper" maxLength={300} />
      </div>
      <div>
        <p className="eyebrow mb-1.5">What is it?</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", category === c ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>
      </div>
      {category === "book" && (
        <div>
          <p className="eyebrow mb-1.5">Kind of book</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of book">
            {BOOK_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={cn("rounded-full border px-3 py-1 text-xs", kind === k ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>{BOOK_KIND_LABEL[k]}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!title.trim()}>Add</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
