import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-engine-first-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "VM_WAKE", "VM_WAKE_GPU", "REPLICATE_API_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const GPU = "https://gpu.example";
const PNG = Buffer.from("89504e470d0a1a0a" + "11".repeat(64), "hex");
const GEMINI_PNG = Buffer.from("89504e470d0a1a0a" + "22".repeat(64), "hex");

/** A GPU engine that can make pictures (or fails), and a Gemini key that works. */
function stubNet(seen: string[], engine: "ok" | "fails") {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    seen.push(url);
    if (url.startsWith(GPU)) {
      if (url.endsWith("/health")) return Response.json({ ok: true });
      if (url.endsWith("/v1/info")) return Response.json({ profile: "full", capabilities: ["pictures", "edit-pictures", "clips", "speech", "music", "sfx"] });
      if (engine === "fails") return Response.json({ detail: "out of GPU memory" }, { status: 500 });
      if (url.endsWith("/v1/images")) return Response.json({ id: "j1" });
      if (url.endsWith("/v1/images/j1")) return Response.json({ status: "succeeded" });
      if (url.endsWith("/v1/images/j1/file")) return new Response(new Uint8Array(PNG));
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: GEMINI_PNG.toString("base64").padEnd(400, "A") } }] } }] });
    }
    return new Response("{}", { status: 404 });
  }));
}

beforeEach(async () => {
  process.env.VIDEO_ENGINE_GPU_URL = GPU;
  process.env.VIDEO_ENGINE_GPU_TOKEN = "gpu-token-1234567890";
  process.env.GEMINI_API_KEY = "AIza-test-key-123456789012345678901234";
  (await import("@/lib/own-video")).resetEngineCapabilities();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["VIDEO_ENGINE_GPU_URL", "VIDEO_ENGINE_GPU_TOKEN", "GEMINI_API_KEY", "ENGINE_FIRST"]) delete process.env[k];
});

describe("Ghost Post's engine first", () => {
  it("makes pictures on the GPU engine first, even though a Gemini key is set", async () => {
    const seen: string[] = [];
    stubNet(seen, "ok");
    const { makeImage } = await import("@/lib/pictures");
    const { engineFirst } = await import("@/lib/own-video");
    expect(await engineFirst("pictures")).toBe(true);
    expect(await engineFirst("lipsync")).toBe(false); // the engine didn't say it can
    const img = await makeImage({ prompt: "a lighthouse at dawn", aspect: "9:16" });
    expect(img.bytes.equals(PNG)).toBe(true);
    expect(seen.some((u) => u.startsWith("https://generativelanguage"))).toBe(false);
  });

  it("falls back to the outside service when the engine fails", async () => {
    const seen: string[] = [];
    stubNet(seen, "fails");
    const { makeImage } = await import("@/lib/pictures");
    const img = await makeImage({ prompt: "a lighthouse at dawn", aspect: "9:16" });
    expect(seen.findIndex((u) => u === `${GPU}/v1/images`)).toBeGreaterThanOrEqual(0);
    expect(seen.findIndex((u) => u.startsWith("https://generativelanguage"))).toBeGreaterThan(seen.indexOf(`${GPU}/v1/images`));
    expect(img.mimeType).toBe("image/png");
  });

  it("can be switched off: then the outside service goes first while the engine is asleep", async () => {
    process.env.ENGINE_FIRST = "off";
    vi.resetModules(); // forget that the engine answered in the tests above (it would count as awake, and be used)
    process.env.VM_WAKE_GPU = "identity=1;subscription=00000000-0000-0000-0000-000000000000;group=G;vm=GhostGPU";
    const seen: string[] = [];
    stubNet(seen, "ok");
    const { makeImage } = await import("@/lib/pictures");
    const { engineFirst } = await import("@/lib/own-video");
    expect(await engineFirst("pictures")).toBe(false);
    await makeImage({ prompt: "a lighthouse at dawn", aspect: "9:16" });
    expect(seen.some((u) => u === `${GPU}/v1/images`)).toBe(false);
    delete process.env.VM_WAKE_GPU;
  });

  it("charges Ghost Post engine animation at its own rate", async () => {
    const { animationSecondCredits } = await import("@/lib/video-spec");
    const { CREDIT_COST } = await import("@/lib/plans");
    expect(animationSecondCredits("own")).toBe(CREDIT_COST.ownSecond);
    expect(animationSecondCredits("veo")).toBe(CREDIT_COST.veoSecond);
  });
});
