import { NextResponse } from "next/server";
import { z } from "zod";
import { route, requireUser } from "@/lib/server/auth";
import { searchCatalog } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/types";

const q = z.object({ q: z.string().trim().min(1).max(120), category: z.enum([...CATEGORIES, "all"]).default("all") });

export const GET = route(async (req: Request) => {
  await requireUser();
  const url = new URL(req.url);
  const params = q.parse({ q: url.searchParams.get("q") ?? "", category: url.searchParams.get("category") ?? "all" });
  const data = await searchCatalog(params.q, params.category);
  return NextResponse.json(data);
});
