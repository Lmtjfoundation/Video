import { authed, ok } from "@/lib/http-api";
import { listPreview } from "@/lib/preview";

export const dynamic = "force-dynamic";

/** The pieces made so far for one job or render (the live preview), the signed-in person's own only. */
export const GET = authed(async (_req, user, ctx) => {
  const { key } = await ctx.params;
  return ok({ items: await listPreview(user.id, key) });
});
