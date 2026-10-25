import { authed, fail } from "@/lib/http-api";
import { canDownload, findAsset, licenseText } from "@/lib/library";

export const dynamic = "force-dynamic";

/** The license certificate for one item, as a text file. */
export const GET = authed(async (req, user) => {
  const a = await findAsset(new URL(req.url).searchParams.get("id") ?? "");
  if (!a) return fail("That item isn't in the Library any more.", 404);
  if (!canDownload(user.plan, user.role)) return fail("The license comes with downloads on every paid plan.", 402);
  return new Response(licenseText(a, { name: user.name, email: user.email }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="license-${a.id}.txt"` },
  });
});
