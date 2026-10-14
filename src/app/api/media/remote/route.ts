import { authed, fail } from "@/lib/http-api";
import { trustedVideoUrl } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Streams a finished video hosted on a trusted host (Claude's content inbox on GitHub) with a proper
 * video/mp4 content type, so the in-app player and download link work in every browser.
 * Range requests pass through, so seeking works without downloading the whole file.
 */
export const GET = authed(async (req) => {
  const url = trustedVideoUrl(new URL(req.url).searchParams.get("u"));
  if (!url) return fail("That video link isn't allowed.", 400);
  const range = req.headers.get("range");
  const res = await fetch(url, { headers: range ? { range } : {}, cache: "no-store" });
  if (!res.ok && res.status !== 206) return fail(`The video couldn't be loaded (HTTP ${res.status}).`, 502);
  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes" });
  for (const k of ["content-length", "content-range", "etag", "last-modified"]) {
    const v = res.headers.get(k);
    if (v) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
});
