import { NextResponse } from "next/server";
import { body, handle } from "@/lib/http-api";
import { publicUser, resetPassword, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Public: sets a new password from an emailed reset token and signs the user in. */
export const POST = handle(async (req: Request) => {
  const b = await body<{ token?: string; password?: string }>(req);
  const { user, token } = await resetPassword(b.token ?? "", b.password ?? "");
  const res = NextResponse.json({ user: publicUser(user) });
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
});
