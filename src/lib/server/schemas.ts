import { z } from "zod";
import { CATEGORIES, DIMENSIONS, ENTRY_STATUSES, RESURFACE_RESPONSES } from "@/lib/types";

export const categorySchema = z.enum(CATEGORIES);

export const catalogResultSchema = z.object({
  category: categorySchema,
  title: z.string().min(1).max(300),
  subtitle: z.string().max(300).nullable().optional().default(null),
  source: z.string().min(1).max(40),
  external_id: z.string().min(1).max(200),
  image_url: z.string().url().nullable().optional().default(null),
  release_year: z.number().int().nullable().optional().default(null),
  creators: z.array(z.object({ name: z.string(), role: z.string() })).optional().default([]),
  genre_tags: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  feel_prior: z.record(z.string(), z.number()).nullable().optional().default(null),
});

export const dimensionsSchema = z.object({
  ...Object.fromEntries([...DIMENSIONS, "loved"].map((d) => [d, z.boolean().optional()])),
}).partial();

export const createEntrySchema = z.object({
  result: catalogResultSchema.optional(),
  media_item_id: z.string().uuid().optional(),
  status: z.enum(ENTRY_STATUSES).default("completed"),
  private_score: z.number().int().min(1).max(10).nullable().optional(),
  consumed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dimensions: dimensionsSchema.optional(),
  note: z.string().max(4000).optional(),
  origin: z.enum(["log", "onboarding_pick", "canon"]).default("log"),
}).refine((v) => v.result || v.media_item_id, { message: "result or media_item_id required" });

export const updateEntrySchema = z.object({
  status: z.enum(ENTRY_STATUSES).optional(),
  private_score: z.number().int().min(1).max(10).nullable().optional(),
  consumed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const reactionSchema = z.object({
  dimensions: dimensionsSchema.optional(),
  note: z.string().max(4000).optional(),
  source: z.enum(["log", "resurface", "onboarding"]).default("log"),
});

export const resurfaceRespondSchema = z.object({
  response: z.enum(RESURFACE_RESPONSES),
  note: z.string().max(4000).optional(),
  snooze_days: z.number().int().min(1).max(365).optional(),
});

export const notificationPrefsSchema = z.object({
  push: z.boolean().optional(),
  cadence: z.enum(["weekly", "biweekly", "monthly", "off"]).optional(),
  snoozed_until: z.string().datetime().nullable().optional(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  user_agent: z.string().max(400).optional(),
});

export const canonReactSchema = z.object({
  result: catalogResultSchema,
  response: z.enum(["loved", "seen", "never"]),
});

/** Pinned / muted tags and dismissed candidates. Lives in users.onboarding_prefs.taste. */
export const tastePrefsSchema = z.object({
  pinned: z.array(z.string().max(40)).max(40).optional(),
  muted: z.array(z.string().max(40)).max(40).optional(),
  hidden: z.array(z.string().max(200)).max(500).optional(),
});

export const hideRecommendationSchema = z.object({
  candidate_key: z.string().min(1).max(200),
  /** Put it back: the card offers an undo right after the tap. */
  undo: z.boolean().optional(),
});

export const phaseUpdateSchema = z.object({
  user_label: z.string().max(80).nullable().optional(),
  dismissed: z.boolean().optional(),
});
