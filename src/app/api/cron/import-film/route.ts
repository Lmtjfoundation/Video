import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { findUserByEmail } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { importFilm } from "@/lib/writers-room";

export const dynamic = "force-dynamic";

/** Owner tool (server access only): put a finished project into someone's Writers' Room. Body: { email, film }. */
export const POST = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const b = (await req.json().catch(() => ({}))) as { email?: string; film?: unknown };
  const user = await findUserByEmail(String(b.email ?? ""));
  if (!user) return fail("No account with that email.", 404);
  try {
    const f = await asUser(user.id, () => importFilm(b.film));
    return ok({ id: f.id, title: f.title, episodes: f.episodes?.length ?? 0, scenes: f.scenes.length, pages: Object.keys(f.pages).length, characters: f.characters.length });
  } catch (e) {
    return fail((e as Error).message);
  }
});
