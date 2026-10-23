import { authed, body, fail, ok } from "@/lib/http-api";
import { createPackCheckout } from "@/lib/billing";
import { appOrigin } from "@/lib/oauth";
import { packById } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const POST = authed(async (req, user) => {
  const b = await body<{ pack: string }>(req);
  if (!packById(b.pack)) return fail("Choose a credit pack.");
  return ok({ url: await createPackCheckout(user, b.pack, appOrigin(req)) });
});
