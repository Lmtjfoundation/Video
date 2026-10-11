import { body, fail, authed, ok } from "@/lib/http-api";
import { listFacebookPages } from "@/lib/facebook-pages";
import { credentialStatuses, getCredential, log, saveCredential } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Choose which Facebook Page to post as, when the linked login manages several. */
export const POST = authed(async (req: Request) => {
  const { pageId } = await body<{ pageId: string }>(req);
  const page = (await listFacebookPages()).find((p) => p.id === pageId);
  if (!page) return fail("That Page isn't available. Connect Facebook again.", 404);
  const cur = (await getCredential("facebook")) ?? {};
  await saveCredential("facebook", { ...cur, accessToken: page.token, accountId: page.id, handle: page.name, method: "oauth" });
  await log("info", "system", `Facebook now posts as the Page “${page.name}”`, { platform: "facebook" });
  return ok(await credentialStatuses());
});
