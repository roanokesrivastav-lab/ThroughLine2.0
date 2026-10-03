import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { signInDestination } from "@/lib/auth/sign-in";

/** Exchanges the code from a magic link / confirmation email for a session cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = signInDestination(url.searchParams.get("next"));
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/auth/sign-in?error=link", url.origin));
}
