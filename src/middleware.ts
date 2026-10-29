import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends signed-out visitors to /login. The session itself is verified on every API call
 * (src/lib/http-api.ts → authed); this only keeps pages from flashing for signed-out users.
 */
const PUBLIC = [
  "/login",
  "/signup",
  "/pricing",
  "/welcome",
  "/terms",
  "/privacy",
  "/data-deletion",
  "/forgot",
  "/reset",
  "/api/auth/",
  "/api/cron/",
  "/api/migrate/",
  "/restore",
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

/**
 * Where this server moved to (Admin → Move to a new server), asked of the app itself at most every 30 seconds and
 * never waited on after the first time. Once moved, every visitor is sent to the same page on the new server.
 */
let moved: { to: string | null; at: number; pending?: Promise<void> } = { to: null, at: 0 };
async function movedTo(req: NextRequest) {
  if (process.env.MOVED_TO) return process.env.MOVED_TO.replace(/\/$/, "");
  if (Date.now() - moved.at > 30_000 && !moved.pending) {
    // The middleware can't read the database itself, so it asks the app (through the server's own address).
    // Asked of the app itself: on its own port when the runtime gives it, else through the public address. Pages and
    // the API also forward by themselves (components/moved-redirect.tsx, http-api.ts), so this is only the fast path.
    const self = process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : req.nextUrl.origin;
    moved.pending = fetch(`${self}/api/migrate/moved`, { cache: "no-store", signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : { to: moved.to }))
      .then((j: { to?: string | null }) => {
        moved = { to: j.to ?? null, at: Date.now() };
      })
      .catch(() => {
        moved = { to: moved.to, at: Date.now() };
      });
    if (!moved.at) await moved.pending; // first request: wait once
  }
  return moved.to;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // A moved server: the scheduler (/api/cron) stops by itself and the new server collects the files (/api/migrate).
  if (!pathname.startsWith("/api/migrate/") && !pathname.startsWith("/api/cron/")) {
    const to = await movedTo(req);
    if (to) return NextResponse.redirect(`${to}${pathname}${search}`, 308);
  }
  if (pathname === "/welcome") {
    // Remember which ad or post the visitor came from (?src=tiktok) for 30 days; sign-up saves it on the account.
    const src = req.nextUrl.searchParams.get("src")?.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    const res = NextResponse.next();
    if (src) res.cookies.set("gp_src", src, { path: "/", maxAge: 30 * 86400, sameSite: "lax", secure: req.nextUrl.protocol === "https:" });
    return res;
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("np_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = req.nextUrl.clone();
  if (pathname === "/") {
    // Signed-out visitors land on the public showcase (the marketing home).
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
