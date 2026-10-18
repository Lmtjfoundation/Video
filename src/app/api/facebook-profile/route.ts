import { body, fail, authed, ok } from "@/lib/http-api";
import { isProfileCred } from "@/lib/facebook-profile";
import { metricoolFor } from "@/lib/metricool";
import { cleanProfileName, normalizeProfileUrl } from "@/lib/facebook-profile";
import { credentialStatuses, getCredential, log, saveCredential } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Use your own Facebook profile (including a monetized profile in professional mode) without Facebook Login.
 * Nothing is posted by the app: Facebook doesn't allow that for profiles. Posts for Facebook are prepared at their
 * time (HD video or image + caption) and you share them from your phone with one tap.
 */
export const POST = authed(async (req: Request) => {
  const input = await body<{ name?: string; url?: string }>(req);
  const name = cleanProfileName(input.name);
  if (!name) return fail("Enter the name on your Facebook profile (up to 80 characters).");
  let url: string | undefined;
  if (input.url?.trim()) {
    const clean = normalizeProfileUrl(input.url);
    if (!clean) return fail("That doesn't look like a Facebook profile link. Copy it from your profile (… → Copy link), or leave it blank.");
    url = clean;
  }
  const cur = (await getCredential("facebook")) ?? {};
  await saveCredential("facebook", {
    ...cur,
    mode: "profile",
    method: cur.method === "oauth" ? "oauth" : "profile",
    profileName: name,
    profileUrl: url ?? cur.profileUrl,
    handle: name,
    accessToken: undefined,
    accountId: undefined,
  });
  await log("info", "system", `Facebook profile “${name}” added — posts are prepared for you to share with one tap`, { platform: "facebook" });
  return ok(await credentialStatuses());
});

/**
 * Autopilot for the profile: posts go to Instagram, and Instagram's own "Share to Facebook" setting puts them on
 * the profile. Needs Instagram connected directly in Ghost Post.
 */
export const PATCH = authed(async (req: Request) => {
  const input = await body<{ viaInstagram?: boolean }>(req);
  const cur = await getCredential("facebook");
  if (!cur || !isProfileCred(cur)) return fail("Add your Facebook profile first.");
  if (input.viaInstagram && !(await getCredential("instagram"))?.accessToken && !(await metricoolFor("instagram"))) {
    return fail("Connect Instagram first — in Ghost Post (Platforms → Instagram) or through Metricool — then switch this on.");
  }
  await saveCredential("facebook", { ...cur, viaInstagram: input.viaInstagram ? "1" : undefined });
  await log("info", "system", input.viaInstagram ? "Facebook profile on autopilot: posts go out through Instagram's sharing to Facebook" : "Facebook profile back to one-tap posting", { platform: "facebook" });
  return ok(await credentialStatuses());
});
