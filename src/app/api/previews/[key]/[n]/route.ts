import { promises as fs } from "fs";
import { authed } from "@/lib/http-api";
import { parseRange } from "@/lib/byte-range";
import { fileStream } from "@/lib/file-stream";
import { previewFile } from "@/lib/preview";

export const dynamic = "force-dynamic";

/** One piece of a live preview (a clip or a picture), streamed with byte ranges so the player can seek. */
export const GET = authed(async (req, user, ctx) => {
  const { key, n } = await ctx.params;
  const piece = await previewFile(user.id, key, Number(n));
  const size = piece && (await fs.stat(piece.file).catch(() => null))?.size;
  if (!piece || !size) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "Content-Type": piece.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" };
  const range = parseRange(req.headers.get("range"), size);
  if (range === null) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  if (range === "none") return new Response(fileStream(piece.file), { headers: { ...headers, "Content-Length": String(size) } });
  return new Response(fileStream(piece.file, range.start, range.end), { status: 206, headers: { ...headers, "Content-Length": String(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${size}` } });
});
