"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HomePayload } from "@/lib/server/home";
import type { EntryDTO } from "@/lib/server/dto";
import type { Recommendation, WeightedTag } from "@/lib/types";
import type { CatalogResult } from "@/lib/catalog/types";
import type { Evolution } from "@/lib/taste/evolution";
import type { Portrait } from "@/lib/taste/portrait";
import type { PhaseWithMembers } from "@/lib/server/phases";
import type { Precision, When } from "@/lib/taste/when";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg || "Request failed");
  }
  return res.json() as Promise<T>;
}

export type ConnectionDTO = { a: EntryDTO; b: EntryDTO; similarity: number; shared: WeightedTag[]; explanation: string };
export type ProfileDTO = {
  email: string | null; onboardingCompletedAt: string | null; onboardingPrefs: Record<string, unknown>;
  notificationPrefs: { push: boolean; cadence: "weekly" | "biweekly" | "monthly" | "off"; snoozed_until: string | null };
  pushSubscriptions: number; entryCount: number;
  capabilities: { push: boolean; ai: "claude" | "nvidia" | "mock"; aiModel: string | null; spotify: boolean; tmdb: boolean; vapidPublicKey: string | null };
};

export const keys = {
  home: ["home"] as const,
  entries: (f: Record<string, string | undefined> = {}) => ["entries", f] as const,
  entry: (id: string) => ["entry", id] as const,
  connections: ["connections"] as const,
  resurface: ["resurface"] as const,
  taste: ["taste"] as const,
  phases: ["phases"] as const,
  profile: ["profile"] as const,
  recommend: (q: string) => ["recommend", q] as const,
  canon: ["canon"] as const,
  tasteTags: ["taste-tags"] as const,
};

export type TastePrefsDTO = { pinned: string[]; muted: string[]; hidden: string[] };
export type TasteTagDTO = { tag: string; weight: number; pinned: boolean; count: number; categories: string[]; specificity: number };
export type TasteTagsPayload = {
  prefs: TastePrefsDTO;
  tags: TasteTagDTO[];
  evidence: { entries: number; taggedEntries: number; notes: number; pinned: number };
};

export const useHome = () => useQuery({ queryKey: keys.home, queryFn: () => api<HomePayload>("/api/home") });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<ProfileDTO>("/api/settings") });
export const useEntries = (f: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: keys.entries(f), queryFn: () => api<{ entries: EntryDTO[] }>(`/api/entries${qs ? `?${qs}` : ""}`) });
};
export const useEntry = (id: string) => useQuery({ queryKey: keys.entry(id), queryFn: () => api<{ entry: EntryDTO; connections: Array<{ other: EntryDTO; similarity: number; shared: WeightedTag[]; explanation: string }>; phases: PhaseWithMembers[] }>(`/api/entries/${id}`) });
export const useConnections = () => useQuery({ queryKey: keys.connections, queryFn: () => api<{ connections: ConnectionDTO[]; withWords: number; total: number }>("/api/connections") });
export const useResurface = () => useQuery({ queryKey: keys.resurface, queryFn: () => api<{ card: { eventId: string; entry: EntryDTO } | null; history: Array<{ id: string; response: string; responded_at: string; entry: EntryDTO }> }>("/api/resurface") });
export const useTaste = () => useQuery({ queryKey: keys.taste, queryFn: () => api<{ portrait: Portrait; evolution: Evolution; entries: Record<string, EntryDTO>; phases: PhaseWithMembers[] }>("/api/taste") });
export const usePhases = () => useQuery({ queryKey: keys.phases, queryFn: () => api<{ phases: PhaseWithMembers[] }>("/api/phases") });
export const useRecommend = (params: Record<string, string | undefined>, enabled = true) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: keys.recommend(qs), queryFn: () => api<{ recommendations: Recommendation[] }>(`/api/recommend?${qs}`), enabled, staleTime: 5 * 60_000 });
};
export const useCanonDeck = () => useQuery({ queryKey: keys.canon, queryFn: () => api<{ cards: CatalogResult[] }>("/api/onboarding/canon"), staleTime: Infinity });

export function useSearch(q: string, category: string) {
  return useQuery({
    queryKey: ["search", q, category],
    queryFn: () => api<{ results: CatalogResult[]; degraded: string[] }>(`/api/search?q=${encodeURIComponent(q)}&category=${category}`),
    enabled: q.trim().length >= 2,
    staleTime: 10 * 60_000,
  });
}

/** Invalidate everything derived from the library after a write. */
export function useInvalidateLibrary() {
  const qc = useQueryClient();
  return () => {
    for (const k of [keys.home, keys.connections, keys.resurface, keys.taste, keys.phases, keys.profile, ["entries"], ["entry"], ["recommend"], keys.canon]) qc.invalidateQueries({ queryKey: k });
  };
}

export type CreateEntryInput = {
  result?: CatalogResult; media_item_id?: string;
  status: "want" | "in_progress" | "completed" | "dropped";
  private_score?: number | null; consumed_at?: string | null; consumed_until?: string | null; consumed_precision?: Precision | null;
  dimensions?: Record<string, boolean>; note?: string; origin?: "log" | "onboarding_pick";
};

export const useTasteTags = () => useQuery({ queryKey: keys.tasteTags, queryFn: () => api<TasteTagsPayload>("/api/recommend/tags") });

/** Pin or mute tags. Optional steering, never required. */
export function useUpdateTastePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<TastePrefsDTO>) => api<{ prefs: TastePrefsDTO }>("/api/recommend/tags", { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tasteTags });
      qc.invalidateQueries({ queryKey: ["recommend"] });
      qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

/** "Not for me" on one recommendation. Item-scoped; never widens to a creator or a kind. */
export function useHideRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { candidate_key: string; undo?: boolean }) =>
      api<{ ok: true; hidden: number }>("/api/recommend/hide", { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tasteTags });
      qc.invalidateQueries({ queryKey: ["recommend"] });
      qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

export function useCreateEntry() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (input: CreateEntryInput) => api<{ entry: EntryDTO | null }>("/api/entries", { method: "POST", json: input }),
    onSuccess: invalidate,
  });
}

export type UpdateEntryInput = Partial<When> & { status?: "want" | "in_progress" | "completed" | "dropped"; private_score?: number | null };

export function useUpdateEntry() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateEntryInput & { id: string }) => api<{ entry: EntryDTO | null }>(`/api/entries/${id}`, { method: "PATCH", json: body }),
    onSuccess: invalidate,
  });
}

/** Optional birth year, used only to turn "as a kid" / "as a teen" into years. Stored in onboarding prefs. */
export function useBirthYear(): { birthYear: number | null; setBirthYear: (y: number) => Promise<unknown> } {
  const profile = useProfile();
  const qc = useQueryClient();
  const raw = profile.data?.onboardingPrefs?.birth_year;
  return {
    birthYear: typeof raw === "number" ? raw : null,
    setBirthYear: async (y: number) => {
      const next = await api<ProfileDTO>("/api/settings", { method: "PATCH", json: { onboardingPrefs: { birth_year: y } } });
      qc.setQueryData(keys.profile, next);
    },
  };
}
