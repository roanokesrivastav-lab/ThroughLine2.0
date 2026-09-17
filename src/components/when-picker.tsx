"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBirthYear } from "@/lib/api";
import { dayWhen, lifeStageWhen, noWhen, rangeWhen, SEASONS, seasonWhen, spanOf, todayIso, yearWhen, type Season, type When } from "@/lib/taste/when";
import { cn } from "@/lib/utils";

type Mode = "now" | "this_year" | "last_year" | "year" | "span" | "kid" | "teen" | "unsure";

const THIS_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1939 }, (_, i) => THIS_YEAR - i);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function modeOf(w: When | null | undefined): Mode | null {
  if (!w) return null;
  if (!w.consumed_at) return "unsure";
  const p = w.consumed_precision ?? "day";
  const y = Number(w.consumed_at.slice(0, 4));
  if (p === "day" || p === "month") return "now";
  if (p === "year" && y === THIS_YEAR) return "this_year";
  if (p === "year" && y === THIS_YEAR - 1) return "last_year";
  if (p === "range") return "span";
  return "year";
}

/**
 * "When, roughly?" Every answer is allowed to be vague, and is stored as vague as it was given:
 * a year stays a year, "as a teen" stays a span. Nothing is ever turned into a false exact date.
 */
export function WhenPicker({ value, onChange, className, allowNow = true }: { value?: When | null; onChange: (w: When) => void; className?: string; allowNow?: boolean }) {
  const { birthYear, setBirthYear } = useBirthYear();
  const span = value ? spanOf(value) : null;
  // The middle of the span, so "Winter 2021" (which starts in December 2020) reopens on 2021.
  const initialYear = span ? span.mid.getUTCFullYear() : THIS_YEAR - 2;
  const [mode, setMode] = useState<Mode | null>(modeOf(value));
  const [year, setYear] = useState(initialYear);
  const [season, setSeason] = useState<Season | "any">(value?.consumed_precision === "season" && value.consumed_at ? seasonFromStart(value.consumed_at) : "any");
  const [from, setFrom] = useState(span ? span.start.getUTCFullYear() : initialYear);
  const [to, setTo] = useState(span ? span.end.getUTCFullYear() : initialYear);
  const [born, setBorn] = useState("");
  const [needsBirth, setNeedsBirth] = useState<"kid" | "teen" | null>(null);

  const choose = (m: Mode) => {
    setMode(m);
    setNeedsBirth(null);
    if (m === "now") onChange(dayWhen(todayIso()));
    if (m === "this_year") onChange(yearWhen(THIS_YEAR));
    if (m === "last_year") onChange(yearWhen(THIS_YEAR - 1));
    if (m === "unsure") onChange(noWhen);
    if (m === "year") onChange(season === "any" ? yearWhen(year) : seasonWhen(year, season));
    if (m === "span") onChange(rangeWhen(from, to));
    if (m === "kid" || m === "teen") {
      if (birthYear) onChange(lifeStageWhen(m, birthYear));
      else setNeedsBirth(m);
    }
  };

  const chips: Array<[Mode, string]> = [
    ...(allowNow ? [["now", "Just now"] as [Mode, string]] : []),
    ["this_year", "This year"], ["last_year", "Last year"], ["year", "Pick a year"], ["span", "Over a few years"],
    ["kid", "As a kid"], ["teen", "As a teen"], ["unsure", "Don't remember"],
  ];
  const summary = span?.label ?? null;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="When, roughly">
        {chips.map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => choose(m)}
            className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", mode === m ? "border-ink bg-ink text-paper" : "border-line bg-card hover:bg-paper-2")}>
            {label}
          </button>
        ))}
      </div>

      {mode === "year" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <NativeSelect label="Year" value={String(year)} onChange={(v) => { const y = Number(v); setYear(y); onChange(season === "any" ? yearWhen(y) : seasonWhen(y, season)); }}
            options={YEARS.map((y) => [String(y), String(y)])} />
          <NativeSelect label="Season" value={season} onChange={(v) => { const s = v as Season | "any"; setSeason(s); onChange(s === "any" ? yearWhen(year) : seasonWhen(year, s)); }}
            options={[["any", "Any time that year"], ...SEASONS.map((s) => [s, cap(s)] as [string, string])]} />
        </div>
      )}

      {mode === "span" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <NativeSelect label="From" value={String(from)} onChange={(v) => { const y = Number(v); setFrom(y); onChange(rangeWhen(y, to)); }} options={YEARS.map((y) => [String(y), String(y)])} />
          <span>to</span>
          <NativeSelect label="To" value={String(to)} onChange={(v) => { const y = Number(v); setTo(y); onChange(rangeWhen(from, y)); }} options={YEARS.map((y) => [String(y), String(y)])} />
        </div>
      )}

      {needsBirth && (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const y = Number(born);
          if (!Number.isInteger(y) || y < 1920 || y > THIS_YEAR) return;
          await setBirthYear(y);
          onChange(lifeStageWhen(needsBirth, y));
          setNeedsBirth(null);
        }}>
          <label htmlFor="born" className="text-sm text-ink-soft">What year were you born? Asked once, only used for this.</label>
          <Input id="born" value={born} onChange={(e) => setBorn(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="e.g. 2004" className="h-9 w-24 bg-card" />
          <Button type="submit" size="sm" variant="outline" disabled={born.length !== 4}>Use it</Button>
        </form>
      )}

      {summary && mode !== "unsure" && !needsBirth && <p className="mt-2 text-xs text-ink-faint">Shows as {summary}{value?.consumed_precision && value.consumed_precision !== "day" ? ", approximate" : ""}.</p>}
    </div>
  );
}

function seasonFromStart(start: string): Season {
  const m = Number(start.slice(5, 7));
  return m === 12 || m <= 2 ? "winter" : m >= 9 ? "autumn" : m >= 6 ? "summer" : "spring";
}

function NativeSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-line bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
