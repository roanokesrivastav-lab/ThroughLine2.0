import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/server";
import { adminConfigured } from "@/lib/supabase/admin";
import { aiEnabled } from "@/lib/ai/extractor";
import { pushConfigured } from "@/lib/server/push";

export function GET() {
  return NextResponse.json({
    ok: true,
    supabase: supabaseConfigured(),
    serviceRole: adminConfigured(),
    ai: aiEnabled() ? "claude" : "mock",
    tmdb: !!process.env.TMDB_API_KEY,
    push: pushConfigured(),
  });
}
