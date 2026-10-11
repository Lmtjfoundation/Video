import { NextResponse } from "next/server";
import { body, handle } from "@/lib/http-api";
import { login, publicUser, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const b = await body<{ email: string; password: string }>(req);
  const { user, token } = await login(b.email ?? "", b.password ?? "");
  const res = NextResponse.json({ user: publicUser(user) });
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
});
