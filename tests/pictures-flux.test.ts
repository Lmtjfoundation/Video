import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-flux-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const PNG = Buffer.from("89504e470d0a1a0a" + "00".repeat(64), "hex");

/** Google refuses (billing off); Replicate takes the uploads and makes the picture. */
function stubNet(seen: { url: string; body?: Record<string, unknown> }[]) {
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    seen.push({ url, body });
    if (url.startsWith("https://generativelanguage.googleapis.com/")) return Response.json({ error: { status: "FAILED_PRECONDITION", message: "This model needs billing enabled on a paid tier" } }, { status: 400 });
    if (url === "https://api.replicate.com/v1/files") return Response.json({ urls: { get: `https://api.replicate.com/v1/files/f${seen.length}` } });
    if (url.startsWith("https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions")) return Response.json({ id: "p1", status: "succeeded", output: "https://replicate.delivery/out.png" });
    if (url === "https://replicate.delivery/out.png") return new Response(new Uint8Array(PNG));
    return new Response("{}", { status: 404 });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["GEMINI_API_KEY", "REPLICATE_API_TOKEN"]) delete process.env[k];
});

describe("AI pictures", () => {
  it("use Flux on Replicate when Gemini's billing is off, with the cast's portraits as references", async () => {
    process.env.GEMINI_API_KEY = "AIza-test-key-123456789012345678901234";
    process.env.REPLICATE_API_TOKEN = "r8_test_token_1234567890";
    const seen: { url: string; body?: Record<string, unknown> }[] = [];
    stubNet(seen);
    const { makeImage, picturesReady } = await import("@/lib/pictures");
    const ref = { mimeType: "image/png", base64: PNG.toString("base64") };
    const img = await makeImage({ prompt: "Ava on a rooftop at dusk", refs: [ref, ref], aspect: "9:16" });
    expect(img.mimeType).toBe("image/png");
    expect(img.bytes.equals(PNG)).toBe(true);
    const pred = seen.find((s) => s.url.includes("flux-2-pro/predictions"))!;
    expect(pred.body?.input).toMatchObject({ prompt: "Ava on a rooftop at dusk", aspect_ratio: "9:16" });
    expect((pred.body?.input as { input_images: string[] }).input_images).toHaveLength(2);
    expect(seen.findIndex((s) => s.url.startsWith("https://generativelanguage"))).toBeLessThan(seen.indexOf(pred));
    expect(await picturesReady()).toBe("gemini");
  });

  it("use Flux straight away when there's no Gemini key, and say pictures are on", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_test_token_1234567890";
    const seen: { url: string; body?: Record<string, unknown> }[] = [];
    stubNet(seen);
    const { makeImage, picturesReady } = await import("@/lib/pictures");
    await makeImage({ prompt: "a city at night", aspect: "16:9" });
    expect(seen.some((s) => s.url.startsWith("https://generativelanguage"))).toBe(false);
    expect((seen.find((s) => s.url.includes("flux-2-pro"))!.body?.input as Record<string, unknown>).input_images).toBeUndefined();
    expect(await picturesReady()).toBe("flux");
  });
});
