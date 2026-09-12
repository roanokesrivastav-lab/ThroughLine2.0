import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/auth", "/~offline", "/manifest.json", "/icons", "/sw.js", "/api/cron", "/api/health", "/dev/"];

/**
 * Refreshes the Supabase session cookie on every request and gates the app routes.
 * API routes return 401 JSON instead of redirecting.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!configured) {
    // Let the setup screen render; everything else bounces there.
    if (pathname === "/setup" || pathname.startsWith("/api/") || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/setup";

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const url = new URL("/auth/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (user && pathname.startsWith("/auth/sign-in")) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|jpeg|webp|ico|txt|xml)$).*)"],
};
