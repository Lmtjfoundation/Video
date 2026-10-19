import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));
vi.mock("@/lib/integrations", () => ({ replicateKey: async () => process.env.REPLICATE_API_TOKEN ?? "" }));

describe("Seedance 2.5 through Replicate", () => {
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
    const { seedanceClip } = await import("@/lib/seedance");
    const out = await seedanceClip({ prompt: "Slow push-in as she turns", start: { mimeType: "image/png", base64: Buffer.from("png").toString("base64") }, aspect: "9:16", seconds: 6 });
    expect([...out]).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.url.startsWith("https://replicate.delivery") || c.auth === "Bearer r8_testtoken")).toBe(true);
    const create = calls.find((c) => c.url.endsWith("/predictions") && c.method === "POST")!;
    expect(JSON.parse(String(create.body)).input).toMatchObject({ image: "https://api.replicate.com/v1/files/abc", duration: 6, resolution: "720p", aspect_ratio: "9:16", generate_audio: false });
  });

  it("explains a rejected token and needs no token to say it isn't connected", async () => {
    const { seedanceClip, testReplicate } = await import("@/lib/seedance");
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
    const plan = (engine?: "veo" | "seedance") => ({ scenes: [scene], ai: { characterIds: [], look: "", veoScenes: [0], engine } });
    const veo = aiVisualCredits(plan("veo") as never), sd = aiVisualCredits(plan("seedance") as never);
    expect(sd - veo).toBe(6 * (CREDIT_COST.seedanceSecond - CREDIT_COST.veoSecond)); // 12 words ≈ 4.6 s → a 6-second clip
    expect(movieEstimate("s60", 3, "seedance").high).toBeGreaterThan(movieEstimate("s60", 3).high);
  });
});
