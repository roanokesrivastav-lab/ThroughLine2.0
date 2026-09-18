// Hand-maintained mirror of supabase/migrations. Keep in sync when the schema changes.
import type { AttributeVector, Category, Dimensions, EntryStatus, Extraction, ResurfaceResponse } from "@/lib/types";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type UsersRow = {
  id: string; email: string | null; onboarding_prefs: Json; notification_prefs: Json;
  onboarding_completed_at: string | null; created_at: string; updated_at: string;
};
export type MediaItemsRow = {
  id: string; category: Category; title: string; subtitle: string | null; source: string; external_id: string;
  image_url: string | null; release_year: number | null; creators: Json; genre_tags: string[]; metadata: Json;
  feel_prior: Json | null;
  // Stage 3 profiling columns (migration 0003, SPEC-STAGE3 §1.2). A profile is usable iff
  // profile_status = 'done' and profile_version equals the PROFILE_VERSION constant in code.
  profile: Json | null; profile_version: string | null;
  profile_status: "pending" | "done" | "failed"; profile_attempts: number;
  profile_error: string | null; profiled_at: string | null;
  created_at: string; updated_at: string;
};
export type EntriesRow = {
  id: string; user_id: string; media_item_id: string; status: EntryStatus; private_score: number | null;
  consumed_at: string | null; consumed_until: string | null; consumed_precision: "day" | "month" | "season" | "year" | "range" | null; origin: "log" | "onboarding_pick" | "canon" | "demo"; created_at: string; updated_at: string;
};
export type ReactionsRow = {
  id: string; entry_id: string; user_id: string; dimensions: Json; raw_note: string | null;
  source: "log" | "onboarding" | "resurface" | "demo"; created_at: string;
};
export type ExtractedAttributesRow = {
  id: string; reaction_id: string; entry_id: string; user_id: string; status: "pending" | "done" | "failed";
  attributes: Json | null; vector: Json | null; vocabulary_version: string; extractor: string | null; attempts: number;
  last_error: string | null; extracted_at: string | null; created_at: string; updated_at: string;
};
export type PhasesRow = {
  id: string; user_id: string; kind: "creator_run" | "album" | "category_stretch" | "feeling_cluster" | "genre_run";
  fingerprint: string; label: string; user_label: string | null; start_at: string; end_at: string; category: Category | null;
  confidence: number; evidence: Json; dismissed: boolean; detected_at: string; created_at: string; updated_at: string;
};
export type PhaseMembersRow = { phase_id: string; entry_id: string; user_id: string; weight: number };
export type ResurfaceEventsRow = {
  id: string; user_id: string; entry_id: string; surfaced_at: string; channel: "home" | "push" | "onboarding";
  response: ResurfaceResponse | null; responded_at: string | null; note_reaction_id: string | null; snoozed_until: string | null; created_at: string;
};
export type QuerySessionsRow = {
  id: string; user_id: string; kind: "recommend" | "home" | "time" | "surprise"; category: Category | null;
  answers: Json; results: Json; created_at: string;
};
export type ImportedActivityRow = {
  id: string; user_id: string; source: string; external_id: string | null; payload: Json; imported_at: string | null;
  processed_at: string | null; created_at: string;
};
export type PushSubscriptionsRow = { id: string; user_id: string; endpoint: string; keys: Json; user_agent: string | null; created_at: string };

export type Database = {
  public: {
    Tables: {
      users: Table<UsersRow>;
      media_items: Table<MediaItemsRow>;
      entries: Table<EntriesRow>;
      reactions: Table<ReactionsRow>;
      extracted_attributes: Table<ExtractedAttributesRow>;
      phases: Table<PhasesRow>;
      phase_members: Table<PhaseMembersRow>;
      resurface_events: Table<ResurfaceEventsRow>;
      query_sessions: Table<QuerySessionsRow>;
      imported_activity: Table<ImportedActivityRow>;
      push_subscriptions: Table<PushSubscriptionsRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// Convenience casts for JSON columns.
export const asDimensions = (j: Json): Dimensions => (j && typeof j === "object" && !Array.isArray(j) ? (j as Dimensions) : {});
export const asVector = (j: Json | null): AttributeVector | null => (j && typeof j === "object" && !Array.isArray(j) ? (j as AttributeVector) : null);
export const asExtraction = (j: Json | null): Extraction | null => (j && typeof j === "object" && !Array.isArray(j) ? (j as unknown as Extraction) : null);
