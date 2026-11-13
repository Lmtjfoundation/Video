import "server-only";
import { NextResponse } from "next/server";
import { LLMError } from "./llm";
import { asUser } from "./db";
import { AuthError, QuotaError, rollUsage, userFromRequest, type User } from "./auth";

export const ok = <T>(data: T, init?: number) => NextResponse.json(data, { status: init ?? 200 });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** A request that can't be done as asked: its message goes to the caller with this status. */
export class RequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function toResponse(e: unknown, user?: User | null) {
  const err = e as Error;
  if (err instanceof RequestError) return fail(err.message, err.status);
  if (err instanceof AuthError) return fail(err.message, err.status);
  if (err instanceof QuotaError) return fail(err.message, 402);
  console.error("[ghost-post:api]", err instanceof LLMError && err.ownerMessage ? `${err.message} | ${err.ownerMessage}` : err);
  // Subscribers get a plain message; the owner sees the real cause (credits, key, workspace…). 503 (not 502): the app
  // is fine, an AI service it depends on isn't answering, and "Retry-After" tells clients when to try again.
  if (err instanceof LLMError) {
    const res = fail(user?.role === "admin" && err.ownerMessage ? `${err.ownerMessage} (Admin → Integrations)` : err.message, 503);
    res.headers.set("Retry-After", err.kind === "config" ? "600" : "30");
    return res;
  }
  return fail(err?.message || "Unexpected error", 500);
}

/** Wraps a public route handler with consistent error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return toResponse(e);
    }
  };
}

type Ctx = { params: Promise<Record<string, string>> };

/**
 * Signed-in route: resolves the user from the session cookie and runs the handler with
 * all per-user data scoped to them. `admin: true` restricts it to admins.
 */
/**
 * After this server was moved (Admin → Move to a new server), its API answers with where Curbvue lives now, so an
 * old open tab or an old link can't keep using the stale copy. Null while it hasn't moved.
 */
export async function movedAnswer(): Promise<Response | null> {
  const to = await (await import("./migrate")).movedTo().catch(() => null);
  if (!to) return null;
  return NextResponse.json({ error: `Curbvue moved to ${to}. Open it there and sign in with the same email and password.`, movedTo: to }, { status: 410 });
}

/** Account, sign-in, billing and key routes: a leaked API key must not be able to take over the account. */
const KEYLESS = ["/api/auth", "/api/account", "/api/billing", "/api/stripe", "/api/plans", "/api/developers", "/api/settings", "/api/admin", "/api/credentials", "/api/app-keys", "/api/ai-provider", "/api/connect", "/api/migrate", "/api/export"];

export function authed(fn: (req: Request, user: User, ctx: Ctx) => Promise<Response>, opts: { admin?: boolean } = {}) {
  return async (req: Request, ctx: Ctx) => {
    const moved = await movedAnswer();
    if (moved) return moved;
    let user: User | null = null;
    try {
      user = await userFromRequest(req);
      // No session: a personal API key (Authorization: Bearer gp_live_…) works too, so the command-line tool and
      // scripts can use every tool the app has. Owner-only (admin) routes never accept a key.
      const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!user && bearer.startsWith("gp_live_")) {
        if (opts.admin) return fail("Admin pages can't be used with an API key. Sign in to the app instead.", 403);
        if (KEYLESS.some((p) => new URL(req.url).pathname.startsWith(p))) return fail("This needs you signed in to the app (account, billing and API keys can't be changed with an API key).", 403);
        const { overLimit, touchKey, userForKey } = await import("./api-keys");
        const found = await userForKey(bearer);
        if (!found) return fail("That API key isn't valid (make one in Curbvue → Developers).", 401);
        if (overLimit(found.keyId)) return fail("Too many requests: the limit is 60 a minute per key.", 429);
        void touchKey(found.keyId).catch(() => {});
        user = await rollUsage(found.user);
      }
      if (!user) return fail("Please sign in.", 401);
      if (opts.admin && user.role !== "admin") return fail("Admins only.", 403);
      const u = user;
      return await asUser(u.id, () => fn(req, u, ctx));
    } catch (e) {
      return toResponse(e, user);
    }
  };
}

/**
 * Developer API route: authenticated by a personal API key (Authorization: Bearer gp_live_…) instead of a session,
 * limited to 60 requests a minute per key, with everything scoped to the key's owner.
 */
export function apiKeyed(fn: (req: Request, user: User, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx) => {
    const moved = await movedAnswer();
    if (moved) return moved;
    let user: User | null = null;
    try {
      const { overLimit, touchKey, userForKey } = await import("./api-keys");
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      const found = token ? await userForKey(token) : null;
      if (!found) return fail("Send a valid API key: Authorization: Bearer gp_live_… (make one in Curbvue → Developers).", 401);
      if (overLimit(found.keyId)) return fail("Too many requests: the limit is 60 a minute per key.", 429);
      user = found.user;
      const u = found.user;
      return await asUser(u.id, async () => {
        void touchKey(found.keyId).catch(() => {});
        return fn(req, u, ctx);
      });
    } catch (e) {
      return toResponse(e, user);
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Constant-time check of the cron bearer secret. */
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
