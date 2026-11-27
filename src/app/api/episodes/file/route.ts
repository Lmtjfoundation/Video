import { promises as fs } from "fs";
import path from "path";
import { authed, fail } from "@/lib/http-api";
import { episodeDir, getEpisode } from "@/lib/episode-studio/run";

export const dynamic = "force-dynamic";

/** A cast portrait or a first frame of one of your episodes (cast/KEY.png, stills/ID.png). */
export const GET = authed(async (req, user) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") ?? "";
  const f = u.searchParams.get("f") ?? "";
  if (!/^(cast|stills)\/[A-Za-z0-9_-]{1,24}\.png$/.test(f)) return fail("Not found.", 404);
  const r = await getEpisode(id);
  if (!r || (r.owner !== user.id && user.role !== "admin")) return fail("Not found.", 404);
  const bytes = await fs.readFile(path.join(episodeDir(r.id), f)).catch(() => null);
  if (!bytes) return fail("Not found.", 404);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": jpeg ? "image/jpeg" : "image/png", "Cache-Control": "private, max-age=3600" } });
});
