import { authed, body, fail, ok } from "@/lib/http-api";
import { refundCredits, spendCredits } from "@/lib/auth";
import { CHARACTER_LOOK_GROUPS, listCharacters } from "@/lib/characters";
import { MediaGenError, type Aspect } from "@/lib/gemini-media";
import { listMedia, signedUrl } from "@/lib/media";
import { CREDIT_COST } from "@/lib/plans";
import { log } from "@/lib/repo";
import { picturesReady } from "@/lib/pictures";
import { IMAGE_MODES, makeStudioImage, STUDIO_PREFIX, type ImageMode } from "@/lib/image-studio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ASPECTS: Aspect[] = ["9:16", "16:9", "1:1"];

/** Image Studio: recent results, the pictures and characters to work from, the art styles, and which engine makes pictures. */
export const GET = authed(async (_req, user) => {
  const media = await listMedia();
  const pictures = media.filter((m) => m.kind === "image").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok({
    engine: await picturesReady(),
    lookGroups: CHARACTER_LOOK_GROUPS,
    credits: CREDIT_COST.aiImage,
    made: pictures.filter((m) => m.name.startsWith(STUDIO_PREFIX)).slice(0, 48).map((m) => ({ id: m.id, name: m.name, url: signedUrl(user.id, m.id, 6 * 3600) })),
    pictures: pictures.slice(0, 60).map((m) => ({ id: m.id, name: m.name, url: signedUrl(user.id, m.id, 6 * 3600) })),
    characters: (await listCharacters()).map((c) => ({ id: c.id, name: c.name, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
  });
});

export const POST = authed(async (req, user) => {
  const b = await body<{ mode?: ImageMode; prompt?: string; look?: string; aspect?: Aspect; mediaId?: string; characterIds?: string[] }>(req);
  const mode = IMAGE_MODES.includes(b.mode as ImageMode) ? (b.mode as ImageMode) : "create";
  if (!String(b.prompt ?? "").trim()) return fail("Describe the picture.");
  if (!(await picturesReady())) return fail("Making pictures needs Ghost Post's engine. The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine.", 503);
  const credits = CREDIT_COST.aiImage;
  await spendCredits(user.id, credits);
  try {
    const item = await makeStudioImage(user.id, {
      mode,
      prompt: String(b.prompt),
      look: b.look,
      aspect: ASPECTS.includes(b.aspect as Aspect) ? (b.aspect as Aspect) : "9:16",
      mediaId: b.mediaId || undefined,
      characterIds: Array.isArray(b.characterIds) ? b.characterIds.slice(0, 3) : undefined,
    });
    await log("info", "generate", `Image Studio (${mode}): ${String(b.prompt).slice(0, 80)}`);
    return ok({ id: item.id, name: item.name, url: signedUrl(user.id, item.id, 6 * 3600) });
  } catch (e) {
    await refundCredits(user.id, credits);
    if (e instanceof MediaGenError) return fail(e.message, 503);
    return fail((e as Error).message);
  }
});
