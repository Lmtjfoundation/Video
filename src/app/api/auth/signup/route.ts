import { NextResponse } from "next/server";
import { body, handle } from "@/lib/http-api";
import { createSession, createUser, publicUser, sessionCookie } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const b = await body<{ email: string; password: string; name?: string; setupCode?: string }>(req);
  const user = await createUser({ email: b.email ?? "", password: b.password ?? "", name: b.name, setupCode: b.setupCode });
  const token = await createSession(user.id);
  await asUser(user.id, () => log("info", "system", user.role === "admin" ? "Admin account created" : "Account created"));
  const res = NextResponse.json({ user: publicUser(user) });
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
});
