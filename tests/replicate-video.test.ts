import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));
vi.mock("@/lib/integrations", () => ({ replicateKey: async () => process.env.REPLICATE_API_TOKEN ?? "" }));

describe("Seedance 2.5 and Wan 2.2 through Replicate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.REPLICATE_API_TOKEN;
  });

  it("uploads the scene picture, asks for a silent clip from it, waits, and downloads the MP4", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_testtoken";
    const calls: { url: string; method: string; body: unknown; auth?: string }[] = [];
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init?.method ?? "GET", body: init?.body, auth: h.Authorization });
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/v1/files")) return json({ urls: { get: "https://api.replicate.com/v1/files/abc" } });
      if (url.endsWith("/models/bytedance/seedance-2.5/predictions")) return json({ id: "p1", status: "starting" });
      if (url.endsWith("/predictions/p1")) return json(++polls < 2 ? { id: "p1", status: "processing" } : { id: "p1", status: "succeeded", output: "https://replicate.delivery/out.mp4" });
      if (url === "https://replicate.delivery/out.mp4") return new Response(new Uint8Array([1, 2, 3]));
      return new Response("not found", { status: 404 });
    }));
    const { seedanceClip } = await import("@/lib/replicate-video");
    const out = await seedanceClip({ prompt: "Slow push-in as she turns", start: { mimeType: "image/png", base64: Buffer.from("png").toString("base64") }, aspect: "9:16", seconds: 6 });
    expect([...out]).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.url.startsWith("https://replicate.delivery") || c.auth === "Bearer r8_testtoken")).toBe(true);
    const create = calls.find((c) => c.url.endsWith("/predictions") && c.method === "POST")!;
    expect(JSON.parse(String(create.body)).input).toMatchObject({ image: "https://api.replicate.com/v1/files/abc", duration: 6, resolution: "720p", aspect_ratio: "9:16", generate_audio: false });
  });

  it("Wan 2.2 asks for its 81-frame clip from the scene picture", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_testtoken";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/v1/files")) return json({ urls: { get: "https://api.replicate.com/v1/files/w" } });
      if (url.endsWith("/models/wan-video/wan-2.2-i2v-fast/predictions")) {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ id: "w1", status: "succeeded", output: "https://replicate.delivery/wan.mp4" });
      }
      if (url === "https://replicate.delivery/wan.mp4") return new Response(new Uint8Array([9]));
      return new Response("not found", { status: 404 });
    }));
    const { wanClip } = await import("@/lib/replicate-video");
    expect([...(await wanClip({ prompt: "p", start: { mimeType: "image/jpeg", base64: "" }, aspect: "16:9", seconds: 8 }))]).toEqual([9]);
    expect(bodies[0].input).toMatchObject({ image: "https://api.replicate.com/v1/files/w", resolution: "720p", num_frames: 81, frames_per_second: 16 });
  });

  it("explains a rejected token and needs no token to say it isn't connected", async () => {
    const { seedanceClip, testReplicate } = await import("@/lib/replicate-video");
    await expect(seedanceClip({ prompt: "x", start: { mimeType: "image/png", base64: "" }, aspect: "16:9", seconds: 4 })).rejects.toThrow(/Replicate API token/);
    expect((await testReplicate()).ok).toBe(false);
    process.env.REPLICATE_API_TOKEN = "r8_bad";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    expect((await testReplicate()).message).toMatch(/rejected the API token/);
  });

  it("prices Seedance scenes at their own rate", async () => {
    const { aiVisualCredits, movieEstimate } = await import("@/lib/video-spec");
    const { CREDIT_COST } = await import("@/lib/plans");
    const scene = { time: "", narration: "one two three four five six seven eight nine ten eleven twelve", onScreen: "", visual: "v", sfx: "" };
    const plan = (engine?: "veo" | "seedance" | "wan") => ({ scenes: [scene], ai: { characterIds: [], look: "", veoScenes: [0], engine } });
    const veo = aiVisualCredits(plan("veo") as never), sd = aiVisualCredits(plan("seedance") as never);
    expect(sd - veo).toBe(6 * (CREDIT_COST.seedanceSecond - CREDIT_COST.veoSecond)); // 12 words ≈ 4.6 s → a 6-second clip
    expect(movieEstimate("s60", 3, "seedance").high).toBeGreaterThan(movieEstimate("s60", 3).high);
    expect(movieEstimate("s60", 3, "wan").high).toBeLessThan(movieEstimate("s60", 3).high);
  });
});
