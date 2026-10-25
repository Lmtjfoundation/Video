import { apiKeyed, body, fail, ok } from "@/lib/http-api";
import { canDownload, downloadLink, findAsset, licenseText } from "@/lib/library";

export const dynamic = "force-dynamic";

/** POST /api/v1/library/download {"id"} → a 15-minute link to the full-quality file and its license (paid plans). */
export const POST = apiKeyed(async (req, user) => {
  const b = await body<{ id?: string }>(req);
  const a = await findAsset(String(b.id ?? ""));
  if (!a) return fail("No such item.", 404);
  if (!canDownload(user.plan, user.role)) return fail("Downloads come with every paid plan.", 402);
  const link = await downloadLink(a);
  return ok({ url: link.url, file_name: link.fileName, license: licenseText(a, { name: user.name, email: user.email }) });
});
