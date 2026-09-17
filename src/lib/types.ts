// Shared domain types used across server and client.
import type { Precision } from "@/lib/taste/when";

export const CATEGORIES = ["movie", "tv", "anime", "book", "music"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  movie: "Film",
  tv: "TV",
  anime: "Anime",
  book: "Book",
  music: "Song",
};

export const CATEGORY_PLURAL: Record<Category, string> = {
  movie: "Films",
  tv: "TV",
  anime: "Anime",
  book: "Books",
  music: "Music",
};

export const ENTRY_STATUSES = ["want", "in_progress", "completed", "dropped"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const STATUS_LABEL: Record<EntryStatus, string> = {
  want: "Want to",
  in_progress: "In progress",
  completed: "Finished",
  dropped: "Dropped",
};

export const DIMENSIONS = [
  "moved_me",
  "stuck_with_me",
  "would_return",
  "changed_perspective",
  "comforted_me",
  "challenged_me",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  moved_me: "Moved me",
  stuck_with_me: "Stuck with me",
  would_return: "Would return to it",
  changed_perspective: "Changed my perspective",
  comforted_me: "Comforted me",
  challenged_me: "Challenged me",
};

/** Reaction dimensions. `loved` comes from onboarding's "Loved it" tap. */
export type Dimensions = Partial<Record<Dimension | "loved", boolean>>;

export const RESURFACE_RESPONSES = ["still_hits", "doesnt_hit", "not_revisited", "snoozed"] as const;
export type ResurfaceResponse = (typeof RESURFACE_RESPONSES)[number];

export type Creator = { name: string; role: string };

/** Books cover more than novels. Web novels, light novels and manga are books with a kind (PRD §5 keeps five categories). */
export const BOOK_KINDS = ["novel", "web_novel", "light_novel", "manga", "comic", "nonfiction", "poetry"] as const;
export type BookKind = (typeof BOOK_KINDS)[number];
export const BOOK_KIND_LABEL: Record<BookKind, string> = {
  novel: "Novel", web_novel: "Web novel", light_novel: "Light novel", manga: "Manga", comic: "Comic", nonfiction: "Non-fiction", poetry: "Poetry",
};

export type MediaMetadata = {
  runtime_minutes?: number;          // movie
  episode_runtime_minutes?: number;  // tv / anime
  episodes?: number;
  pages?: number;                    // book
  duration_seconds?: number;         // music
  album?: string;
  overview?: string;
  book_kind?: BookKind;
  encounter_weight?: number;         // canon only: rough likelihood the user has met this title. Never displayed.
  [key: string]: unknown;
};

export type MediaItem = {
  id: string;
  category: Category;
  title: string;
  subtitle: string | null;
  source: string;
  external_id: string;
  image_url: string | null;
  release_year: number | null;
  creators: Creator[];
  genre_tags: string[];
  metadata: MediaMetadata;
  feel_prior: AttributeVector | null;
};

export type Entry = {
  id: string;
  user_id: string;
  media_item_id: string;
  status: EntryStatus;
  private_score: number | null;
  consumed_at: string | null;
  consumed_until: string | null;
  consumed_precision: Precision | null;
  origin: "log" | "onboarding_pick" | "canon" | "demo";
  created_at: string;
  updated_at: string;
};

export type Reaction = {
  id: string;
  entry_id: string;
  user_id: string;
  dimensions: Dimensions;
  raw_note: string | null;
  source: "log" | "onboarding" | "resurface" | "demo";
  created_at: string;
};

export type ExtractedAttributes = {
  id: string;
  reaction_id: string;
  entry_id: string;
  user_id: string;
  status: "pending" | "done" | "failed";
  attributes: Extraction | null;
  vector: AttributeVector | null;
  vocabulary_version: string;
  extractor: string | null;
  attempts: number;
  last_error: string | null;
  extracted_at: string | null;
  created_at: string;
};

export type Phase = {
  id: string;
  user_id: string;
  kind: "creator_run" | "album" | "category_stretch" | "feeling_cluster" | "genre_run";
  fingerprint: string;
  label: string;
  user_label: string | null;
  start_at: string;
  end_at: string;
  category: Category | null;
  confidence: number;
  evidence: Record<string, unknown>;
  dismissed: boolean;
  detected_at: string;
};

export type ResurfaceEvent = {
  id: string;
  user_id: string;
  entry_id: string;
  surfaced_at: string;
  channel: "home" | "push" | "onboarding";
  response: ResurfaceResponse | null;
  responded_at: string | null;
  note_reaction_id: string | null;
  snoozed_until: string | null;
};

export type NotificationPrefs = {
  push: boolean;
  cadence: "weekly" | "biweekly" | "monthly" | "off";
  snoozed_until: string | null;
};

/** A flattened attribute space: "tone.tender" -> 0..1, plus scalars "intensity", "ache", "pace". */
export type AttributeVector = Record<string, number>;

export type WeightedTag = { key: string; weight: number };

/** Structured output of the extraction step (shared vocabulary, category-agnostic). */
export type Extraction = {
  tones: WeightedTag[];
  registers: WeightedTag[];
  textures: WeightedTag[];
  aftertastes: WeightedTag[];
  themes: WeightedTag[];
  intensity: number;
  ache: number;
  pace: number;
  /** A short phrase, e.g. "quiet devastation" — used verbatim in explanations. */
  summary: string;
  /** A short verbatim excerpt of the user's own words, or null. */
  quote: string | null;
};

/** An entry joined with its media item and everything the engines need. */
export type EntryWithContext = {
  entry: Entry;
  item: MediaItem;
  reactions: Reaction[];
  extractions: ExtractedAttributes[];
  resurfaces: ResurfaceEvent[];
};

export type Connection = {
  a: EntryWithContext;
  b: EntryWithContext;
  similarity: number;
  shared: WeightedTag[];
  explanation: string;
};

/** Which signal produced a recommendation. Derived from the arithmetic, never chosen by hand. */
export type Route = "tag_overlap" | "creator" | "feeling" | "backlog";

/** One term of the normalised blend. `value` is null when there is no evidence either way. */
export type ScoreComponent = { key: string; label: string; weight: number; value: number | null; contribution: number };

/** An additive nudge applied after normalisation, so its cap is literal. */
export type ScoreAdjustment = { key: string; label: string; delta: number };

/** One tag the candidate and the profile share. `via` is the tag the candidate actually carried. */
export type TagMatch = { tag: string; via: string; profileWeight: number; specificity: number; contribution: number };

export type Recommendation = {
  item: MediaItem;
  entryId?: string;              // present when the candidate is from the user's own backlog
  score: number;
  route: Route;
  breakdown: {
    components: ScoreComponent[];
    adjustments: ScoreAdjustment[];
    normalisedWeight: number;
    total: number;
    matchedTags: TagMatch[];
    tagCoverage: number;
    creator: { name: string; role: string; entryIds: string[] } | null;
    // Legacy mirror, kept so callers written against the first engine keep working.
    attribute_similarity: number;
    bridge_similarity: number;
    reaction_bonus: number;
    score_hint: number;
    creator_bridge: number;
  };
  bridge: {
    entryId: string;
    title: string;
    category: Category;
    summary: string | null;
    quote: string | null;
    shared: WeightedTag[];
  } | null;
  explanation: string;
  fits: string | null;           // e.g. "Fits 40 minutes"
};
