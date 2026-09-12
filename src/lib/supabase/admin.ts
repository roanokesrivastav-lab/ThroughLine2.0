import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

let client: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role client. Bypasses RLS — use only for the shared media catalog and cron sweeps,
 * and never let it touch the browser.
 */
export function supabaseAdmin() {
  if (client) return client;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function adminConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
