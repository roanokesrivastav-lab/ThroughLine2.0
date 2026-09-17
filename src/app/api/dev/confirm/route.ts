import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin, adminConfigured } from "@/lib/supabase/admin";

/**
 * TEMPORARY dev-only escape hatch: creates the account already confirmed, or confirms an
 * existing one, so testing does not depend on confirmation email delivery.
 *
 * Hard-disabled in production, and the service role key never leaves the server. Delete this
 * route (and the button in the sign-in screen) once email delivery works; the real fix is to
 * turn "Confirm email" back on in the Supabase dashboard.
 */
const Body = z.object({ email: z.string().email(), password: z.string().min(6) });

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!adminConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 500 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email and a password of at least 6 characters are required" }, { status: 400 });
  const { email, password } = parsed.data;

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return NextResponse.json({ ok: true, created: true });

  // Already registered: find them and mark the address confirmed, leaving their password alone.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) return NextResponse.json({ error: error.message }, { status: 400 });

  const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { email_confirm: true });
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ ok: true, created: false });
}
