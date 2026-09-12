// CLI demo seeder: creates (or reuses) the demo account and loads the demo library into it.
// Usage: npm run seed:demo   (reads .env.local; needs SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL, DEMO_PASSWORD)
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.DEMO_EMAIL ?? "demo@throughline.local";
  const password = process.env.DEMO_PASSWORD ?? "throughline-demo";
  if (!url || !service || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required");

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
    console.log(`created ${email}`);
  }

  // Seed through the real RLS-scoped path by signing in as the demo user.
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data: session, error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr || !session.session) throw signInErr ?? new Error("sign-in failed");

  const { seedDemo } = await import("../src/lib/server/demo");
  const result = await seedDemo(client as never, user!.id);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nSign in at /auth/sign-in with ${email} / ${password}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
