import "server-only";
import { NextResponse } from "next/server";
import { LLMError } from "./llm";
import { asUser } from "./db";
import { AuthError, QuotaError, userFromRequest, type User } from "./auth";

export const ok = <T>(data: T, init?: number) => NextResponse.json(data, { status: init ?? 200 });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

function toResponse(e: unknown, user?: User | null) {
  const err = e as Error;
  if (err instanceof AuthError) return fail(err.message, err.status);
  if (err instanceof QuotaError) return fail(err.message, 402);
  console.error("[nexus:api]", err instanceof LLMError && err.ownerMessage ? `${err.message} | ${err.ownerMessage}` : err);
  // Subscribers get a plain message; the owner sees the real cause (credits, key, workspace…).
  if (err instanceof LLMError) return fail(user?.role === "admin" && err.ownerMessage ? err.ownerMessage : err.message, 502);
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
export function authed(fn: (req: Request, user: User, ctx: Ctx) => Promise<Response>, opts: { admin?: boolean } = {}) {
  return async (req: Request, ctx: Ctx) => {
    let user: User | null = null;
    try {
      user = await userFromRequest(req);
      if (!user) return fail("Please sign in.", 401);
      if (opts.admin && user.role !== "admin") return fail("Admins only.", 403);
      const u = user;
      return await asUser(u.id, () => fn(req, u, ctx));
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
