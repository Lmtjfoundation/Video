import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-image-tools-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

/** A 400×240 PNG (wide), made with ffmpeg. */
function widePng() {
  const f = path.join(dir, "wide.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x336699:s=400x240", "-frames:v", "1", f]);
  return readFileSync(f);
}

function fakeEngine(png: Buffer) {
  const requests: { prompt: string; images: string[]; aspect: string; op?: string; scale?: number }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    if (p === "/v1/images" && init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({ id: `img${requests.length}`, status: "queued" });
    }
    if (/^\/v1\/images\/img\d+$/.test(p)) return Response.json({ status: "succeeded", progress: 1 });
    if (/^\/v1\/images\/img\d+\/file$/.test(p)) return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    return new Response("not found", { status: 404 });
  });
  return { requests, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("Image Studio tools", () => {
  it("words each tool for the edit model, and sends upscale and cut-outs to their own models", async () => {
    const png = widePng();
    const engine = fakeEngine(png);
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example/";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { makeToolImage, imageToolCredits, toolRequest } = await import("@/lib/image-studio");
    const { IMAGE_TOOLS, angleInstruction } = await import("@/lib/image-tools");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_tools";
    await asUser(user, async () => {
      const pic = await storeFile(user, { name: "street.png", type: "image/png", bytes: png });
      const ref = { mimeType: "image/png", base64: png.toString("base64") };

      // Every instruction tool keeps the picture and says what to change.
      for (const t of IMAGE_TOOLS.filter((x) => x.cost === "image" && x.id !== "swap")) {
        const r = await toolRequest({ tool: t.id, mediaId: pic.id, prompt: "the red car" }, ref);
        expect(r.refs).toHaveLength(1);
        expect(r.prompt).toMatch(/picture 1/);
      }
      expect((await toolRequest({ tool: "erase", mediaId: pic.id, prompt: "the red car" }, ref)).prompt).toMatch(/^Remove the red car from picture 1/);
      await expect(toolRequest({ tool: "background", mediaId: pic.id }, ref)).rejects.toThrow(/new background/);
      await expect(toolRequest({ tool: "swap", mediaId: pic.id }, ref)).rejects.toThrow(/character/);
      expect(angleInstruction({ rotate: -45, tilt: 20, lens: "close" })).toBe("the camera orbits 45 degrees to the left around the subject, a high angle looking down 20 degrees, a close-up");

      // An edit keeps the picture's own shape (this one is wide); expand uses the shape asked for.
      const relit = await makeToolImage(user, { tool: "relight", mediaId: pic.id, prompt: "golden hour" });
      expect(engine.requests.at(-1)).toMatchObject({ aspect: "16:9" });
      expect(engine.requests.at(-1)!.prompt).toContain("Relight picture 1: golden hour");
      expect(relit.name).toBe("studio-relight-street.png");
      await makeToolImage(user, { tool: "expand", mediaId: pic.id, aspect: "9:16" });
      expect(engine.requests.at(-1)).toMatchObject({ aspect: "9:16" });

      const up = await makeToolImage(user, { tool: "upscale", mediaId: pic.id, scale: 2 });
      expect(engine.requests.at(-1)).toMatchObject({ op: "upscale", scale: 2 });
      expect(up.name).toBe("studio-upscale-street.png");
      await makeToolImage(user, { tool: "remove-bg", mediaId: relit.id });
      expect(engine.requests.at(-1)).toMatchObject({ op: "remove-bg" });
      expect(engine.requests.at(-1)!.images).toHaveLength(1);

      expect(imageToolCredits("upscale")).toBe(CREDIT_COST.upscale);
      expect(imageToolCredits("remove-bg")).toBe(CREDIT_COST.removeBg);
      expect(imageToolCredits("erase")).toBe(CREDIT_COST.aiImage);
    });
  });
});
