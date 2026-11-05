import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { engineCapabilities, engines, ownImage, testOwnEngine } from "@/lib/own-video";

export const dynamic = "force-dynamic";
export const maxDuration = 1200;

/**
 * Owner tool (server access only): wake each connected engine, record what it can do, and with ?picture=1 make one
 * test picture on the engine that does pictures. Answers how long it took.
 */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const out: Record<string, unknown>[] = [];
  for (const e of await engines()) {
    const t = Date.now();
    const test = await testOwnEngine(e.kind);
    out.push({ kind: e.kind, url: e.url, ...test, capabilities: await engineCapabilities(e), seconds: Math.round((Date.now() - t) / 1000) });
  }
  let picture: Record<string, unknown> | undefined;
  if (new URL(req.url).searchParams.get("picture") === "1") {
    const t = Date.now();
    try {
      const bytes = await ownImage({ prompt: "A school hallway at night, waxed floor shining under fluorescent lights, cinematic film still", aspect: "9:16" });
      picture = { ok: true, bytes: bytes.length, seconds: Math.round((Date.now() - t) / 1000) };
    } catch (e) {
      picture = { ok: false, error: (e as Error).message, seconds: Math.round((Date.now() - t) / 1000) };
    }
  }
  return ok({ engines: out, picture });
});
