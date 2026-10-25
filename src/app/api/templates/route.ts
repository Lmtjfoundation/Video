import { authed, body, ok } from "@/lib/http-api";
import { signedUrl } from "@/lib/media";
import { log } from "@/lib/repo";
import { renderTemplate, TEMPLATE_DEFS } from "@/lib/video-templates";
import type { TemplateInput } from "@/lib/template-defs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = authed(async () => ok({ templates: TEMPLATE_DEFS }));

/** Renders a video template (free: drawn by ffmpeg on the server) into the Media Library. */
export const POST = authed(async (req, user) => {
  const b = await body<TemplateInput>(req);
  const item = await renderTemplate(user.id, { ...b, aspect: ["9:16", "16:9", "1:1"].includes(b.aspect) ? b.aspect : "9:16", values: b.values ?? {} });
  await log("info", "generate", `Template rendered: ${item.name}`);
  return ok({ id: item.id, name: item.name, type: item.type, url: signedUrl(user.id, item.id, 6 * 3600) });
});
