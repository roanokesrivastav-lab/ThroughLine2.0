import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

// Always render per request: these screens depend on the session cookie.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) redirect("/setup");
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");
  return <AppShell>{children}</AppShell>;
}
