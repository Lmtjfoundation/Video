import { authed, body, fail, ok } from "@/lib/http-api";
import { canDownload, downloadLink, findAsset, licenseText } from "@/lib/library";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** A short-lived link to the full-quality file (paid plans), with the license text for it. */
export const POST = authed(async (req, user) => {
  const b = await body<{ id?: string }>(req);
  const a = await findAsset(String(b.id ?? ""));
  if (!a) return fail("That item isn't in the Library any more.", 404);
  if (!canDownload(user.plan, user.role)) return fail("Downloads come with every paid plan. On Free you can listen, watch and save to boards.", 402);
  const link = await downloadLink(a);
  await log("info", "generate", `Library download: ${a.title}`);
  return ok({ ...link, license: licenseText(a, { name: user.name, email: user.email }) });
});
