import { NextResponse } from "next/server";
import { handle } from "@/lib/http-api";
import { SESSION_COOKIE, destroySession, readCookie, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(null));
  return res;
});
