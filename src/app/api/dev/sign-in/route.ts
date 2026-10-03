import { NextResponse } from "next/server";
import { adminConfigured, supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { signInError } from "@/lib/auth/sign-in";

/** Explicit local development access to one configured, existing account. */
export async function POST(req: Request) {
  const allowedEmail = process.env.DEV_SIGN_IN_EMAIL?.trim().toLowerCase();
  if (process.env.NODE_ENV !== "development" || !allowedEmail) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const url = new URL(req.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || req.headers.get("origin") !== url.origin) {
    return NextResponse.json({ error: "Local sign-in requires this app on localhost." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.email !== "string" || body.email.trim().toLowerCase() !== allowedEmail) {
    return NextResponse.json({ error: "This email is not configured for local sign-in." }, { status: 403 });
  }
  if (!adminConfigured()) return NextResponse.json({ error: "Local sign-in is not configured on the server." }, { status: 503 });
  try {
    const admin = supabaseAdmin();
    // generateLink can create a missing account; require an existing one first.
    const { data: list, error: lookupError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (lookupError) throw lookupError;
    if (!list.users.some((user) => user.email?.toLowerCase() === allowedEmail)) {
      return NextResponse.json({ error: "The configured account was not found." }, { status: 404 });
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: allowedEmail });
    if (error) throw error;
    const supabase = await supabaseServer();
    const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
    if (verifyError) throw verifyError;
    // Cookie-bound verification sets the session. No credentials or tokens in JSON.
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: signInError(error) }, { status: 503 });
  }
}
