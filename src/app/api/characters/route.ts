import { authed, body, fail, ok } from "@/lib/http-api";
import { refundCredits, spendCredits } from "@/lib/auth";
import { CHARACTER_LOOKS, createCharacter, deleteCharacter, listCharacters } from "@/lib/characters";
import { mediaKey, MediaGenError } from "@/lib/gemini-media";
import { signedUrl } from "@/lib/media";
import { CREDIT_COST } from "@/lib/plans";
import { log } from "@/lib/repo";
import { seedanceReady } from "@/lib/seedance";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** The account's characters with portrait links, the art styles, and whether the app can make pictures. */
export const GET = authed(async (_req, user) => {
  const list = await listCharacters();
  return ok({
    characters: list.map((c) => ({ ...c, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
    looks: CHARACTER_LOOKS,
    ready: !!(await mediaKey()),
    seedance: await seedanceReady(),
  });
});

/** Makes a character portrait from a photo (Media Library id) and/or a description. Pictures use the app's Gemini key, so credits apply. */
export const POST = authed(async (req, user) => {
  const b = await body<{ name?: string; description?: string; look?: string; photoId?: string; consent?: boolean }>(req);
  if (b.photoId && !b.consent) return fail("Confirm the photo is of you, or that you have permission from the person in it.");
  if (!(await mediaKey())) return fail("Making characters needs the app's Gemini key. Ask the admin to add it in Admin → App settings → Integrations.", 503);
  const credits = CREDIT_COST.character;
  await spendCredits(user.id, credits);
  try {
    const c = await createCharacter(user.id, { name: String(b.name ?? ""), description: b.description, look: String(b.look ?? ""), photoId: b.photoId || undefined });
    await log("info", "generate", `Character created: ${c.name}`);
    return ok({ ...c, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) });
  } catch (e) {
    await refundCredits(user.id, credits);
    if (e instanceof MediaGenError && e.kind === "config") await log("error", "system", `Character picture failed: ${e.message}`);
    return fail((e as Error).message);
  }
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Character not found.", 404);
  await deleteCharacter(id);
  return ok({ ok: true });
});
