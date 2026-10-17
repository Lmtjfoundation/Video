import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends signed-out visitors to /login. The session itself is verified on every API call
 * (src/lib/http-api.ts → authed); this only keeps pages from flashing for signed-out users.
 */
const PUBLIC = [
  "/login",
  "/signup",
  "/pricing",
  "/terms",
  "/privacy",
  "/data-deletion",
  "/forgot",
  "/reset",
  "/api/auth/",
  "/api/cron/",
  "/api/stripe/",
  "/api/plans",
  "/api/media/file/",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/icons/",
  "/promo/", // public ad videos and images that Metricool and the social networks download without signing in
  "/icon",
  "/apple-icon",
];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("np_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = req.nextUrl.clone();
  if (pathname === "/") {
    // Signed-out visitors land on the public pricing page (the marketing home).
    url.pathname = "/pricing";
    url.search = "";
    return NextResponse.redirect(url);
  }
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
