// When something was consumed, as honestly as the user can say it.
// Pure and client-safe: used by the engines, the API and the pickers.

export const PRECISIONS = ["day", "month", "season", "year", "range"] as const;
export type Precision = (typeof PRECISIONS)[number];

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

/** The three columns on `entries` that together say when. */
export type When = { consumed_at: string | null; consumed_until: string | null; consumed_precision: Precision | null };

export type Span = { start: Date; end: Date; mid: Date; precision: Precision; label: string };

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Anything vaguer than a season cannot place an entry inside a 45–75 day phase window. */
export const PHASE_MAX_SPAN_DAYS = 100;

/** Northern-hemisphere seasons (DECISIONS #15). Winter 2021 is Dec 2020 – Feb 2021. */
export function seasonOf(d: Date): { season: Season; year: number } {
  const m = d.getUTCMonth();
  if (m === 11) return { season: "winter", year: d.getUTCFullYear() + 1 };
  if (m <= 1) return { season: "winter", year: d.getUTCFullYear() };
  if (m <= 4) return { season: "spring", year: d.getUTCFullYear() };
  if (m <= 7) return { season: "summer", year: d.getUTCFullYear() };
  return { season: "autumn", year: d.getUTCFullYear() };
}

export function seasonBounds(year: number, season: Season): { from: string; to: string } {
  switch (season) {
    case "winter": return { from: `${year - 1}-12-01`, to: `${year}-02-${pad(lastDay(year, 1))}` };
    case "spring": return { from: `${year}-03-01`, to: `${year}-05-31` };
    case "summer": return { from: `${year}-06-01`, to: `${year}-08-31` };
    case "autumn": return { from: `${year}-09-01`, to: `${year}-11-30` };
  }
}

export const dayWhen = (date: string): When => ({ consumed_at: date, consumed_until: null, consumed_precision: "day" });
export const monthWhen = (year: number, month1: number): When => ({ consumed_at: `${year}-${pad(month1)}-01`, consumed_until: `${year}-${pad(month1)}-${pad(lastDay(year, month1 - 1))}`, consumed_precision: "month" });
export const yearWhen = (year: number): When => ({ consumed_at: `${year}-01-01`, consumed_until: `${year}-12-31`, consumed_precision: "year" });
export function seasonWhen(year: number, season: Season): When {
  const b = seasonBounds(year, season);
  return { consumed_at: b.from, consumed_until: b.to, consumed_precision: "season" };
}
export function rangeWhen(fromYear: number, toYear: number): When {
  const [a, b] = fromYear <= toYear ? [fromYear, toYear] : [toYear, fromYear];
  return a === b ? yearWhen(a) : { consumed_at: `${a}-01-01`, consumed_until: `${b}-12-31`, consumed_precision: "range" };
}
export const noWhen: When = { consumed_at: null, consumed_until: null, consumed_precision: null };
export const todayIso = () => iso(new Date());

/** The span a When covers, or null when nothing was said. */
export function spanOf(w: When): Span | null {
  if (!w.consumed_at) return null;
  const start = new Date(`${w.consumed_at}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const precision: Precision = w.consumed_precision ?? "day";
  const endIso = precision === "day" ? w.consumed_at : (w.consumed_until ?? w.consumed_at);
  const end = new Date(`${endIso}T00:00:00Z`);
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  return { start, end, mid, precision, label: labelFor(precision, start, end, mid) };
}

function labelFor(p: Precision, start: Date, end: Date, mid: Date): string {
  switch (p) {
    case "day":
    case "month": return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
    case "season": { const s = seasonOf(mid); return `${cap(s.season)} ${s.year}`; }
    case "year": return `~${start.getUTCFullYear()}`;
    case "range": return `~${start.getUTCFullYear()}–${end.getUTCFullYear()}`;
  }
}

type EntryLike = When & { origin: string; created_at: string };

/**
 * When an entry happened. Onboarding and canon entries the user never dated are undated (null),
 * because the day they were tapped says nothing about when they were watched or read.
 * Entries logged normally fall back to the day they were logged.
 */
export function entrySpan(e: EntryLike): Span | null {
  const s = spanOf(e);
  if (s) return s;
  if (e.origin === "onboarding_pick" || e.origin === "canon") return null;
  return spanOf(dayWhen(e.created_at.slice(0, 10)));
}

export const spanDays = (s: Span) => (s.end.getTime() - s.start.getTime()) / DAY;

/** Resolve the life-stage shortcuts against an optional birth year. */
export function lifeStageWhen(stage: "kid" | "teen", birthYear: number): When {
  const now = new Date().getUTCFullYear();
  const [a, b] = stage === "kid" ? [birthYear + 6, birthYear + 12] : [birthYear + 13, birthYear + 19];
  return rangeWhen(Math.min(a, now), Math.min(b, now));
}
