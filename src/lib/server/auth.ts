import "server-only";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Resolves the signed-in user and an RLS-bound client, or throws a 401. */
export async function requireUser() {
  const supabase = await supabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, "Not signed in");
  return { user, supabase };
}

/** Wraps a route handler so thrown HttpErrors and validation errors become JSON responses. */
export function route<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err && typeof err === "object" && "issues" in err) return NextResponse.json({ error: "Invalid input", issues: (err as { issues: unknown }).issues }, { status: 400 });
      console.error(err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
