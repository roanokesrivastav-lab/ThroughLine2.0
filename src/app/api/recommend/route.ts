import { NextResponse, after } from "next/server";
import { z } from "zod";
import { route, requireUser } from "@/lib/server/auth";
import { buildStageRecommendations, queueDeferredProfiles, supabaseRecommendStore } from "@/lib/server/stage-recommend";
import { adapterFor } from "@/lib/catalog";
import { getExplainer } from "@/lib/ai/explainer";
import { CATEGORIES } from "@/lib/types";

const schema = z.object({
  category: z.enum(CATEGORIES).optional(),
  minutes: z.enum(["20", "40", "60", "150"]).optional(),
  listOnly: z.enum(["1", "true"]).optional(),
  returnable: z.enum(["1", "true"]).optional(),
  shortRead: z.enum(["1", "true"]).optional(),
  surprise: z.enum(["1", "true"]).optional(),
});

export const GET = route(async (req: Request) => {
  const { user, supabase } = await requireUser();
  const url = new URL(req.url);
  const p = schema.parse(Object.fromEntries([...url.searchParams.entries()].filter(([, v]) => v !== "")));
  const filters = {
    category: p.category ?? null,
    minutes: p.minutes ? (Number(p.minutes) as 20 | 40 | 60 | 150) : null,
    listOnly: !!p.listOnly || !!p.surprise,
    returnable: !!p.returnable,
    shortRead: !!p.shortRead,
    surprise: !!p.surprise,
    limit: 5,
  };
  const kind = p.surprise ? "surprise" : p.minutes ? "time" : "recommend";
  const { recommendations, deferred } = await buildStageRecommendations(
    supabaseRecommendStore(supabase),
    { adapterFor, now: () => new Date(), explain: (s) => getExplainer().explain(s) },
    user.id,
    filters,
    { kind },
  );
  after(() => queueDeferredProfiles(deferred));
  return NextResponse.json({ recommendations, filters });
});
