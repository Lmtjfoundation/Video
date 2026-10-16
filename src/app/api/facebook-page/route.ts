import { body, fail, authed, ok } from "@/lib/http-api";
import { listFacebookPages } from "@/lib/facebook-pages";
import { credentialStatuses, getCredential, log, saveCredential } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Choose where Facebook posts go: one of the Pages the linked login manages (automatic posting),
 * or the person's own profile ({ target: "profile" }), where each post is prepared and shared with one tap.
 */
export const POST = authed(async (req: Request) => {
  const { pageId, target } = await body<{ pageId?: string; target?: "profile" }>(req);
  const cur = (await getCredential("facebook")) ?? {};

  if (target === "profile") {
    if (!cur.profileName) return fail("Connect Facebook first, or add your profile on the Facebook card.", 404);
    // The Page token isn't needed for profile posting, so it isn't kept on the active connection (the Page list still has it).
    await saveCredential("facebook", { ...cur, mode: "profile", accessToken: undefined, accountId: undefined, handle: cur.profileName });
    await log("info", "system", `Facebook now prepares posts for your profile “${cur.profileName}” — you post them with one tap`, { platform: "facebook" });
    return ok(await credentialStatuses());
  }

  const page = (await listFacebookPages()).find((p) => p.id === pageId);
  if (!page) return fail("That Page isn't available. Connect Facebook again.", 404);
  await saveCredential("facebook", { ...cur, mode: "page", accessToken: page.token, accountId: page.id, handle: page.name, method: "oauth" });
  await log("info", "system", `Facebook now posts as the Page “${page.name}”`, { platform: "facebook" });
  return ok(await credentialStatuses());
});
