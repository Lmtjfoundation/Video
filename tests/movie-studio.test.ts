import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_COST } from "@/lib/plans";
import { aiVisualCredits, movieEstimate, renderCredits, veoSeconds, videoCredits } from "@/lib/video-spec";
import { findImage, geminiImage, googleProblem, veoClip } from "@/lib/gemini-media";
import { pickVeoScenes } from "@/lib/movie";
import { cleanExplanation, explanationText } from "@/lib/explain";
import type { VideoPlan, VideoScene } from "@/lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-movie-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_IMAGE_MODEL", "VEO_MODEL"]) delete process.env[k];
process.env.GEMINI_API_KEY = "test-gemini-key";

vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const scene = (narration: string, onScreen = ""): VideoScene => ({ time: "", narration, onScreen, visual: "a shot", motion: "", sfx: "" });
const plan = (scenes: VideoScene[], ai?: VideoPlan["ai"]): VideoPlan => ({
  niche: "x", style: "fiction", length: "s60", titles: [], thumbnail: {}, voice: "", music: "", scenes, loopLine: "", factCheck: [], ai,
});
const PNG = Buffer.alloc(600, 7).toString("base64");

describe("credits for AI visuals", () => {
  it("rounds each Veo scene up to a 4, 6 or 8 second clip", () => {
    expect(veoSeconds(scene(words(5)))).toBe(4); // ≈1.9 s
    expect(veoSeconds(scene(words(10)))).toBe(4); // ≈3.8 s
    expect(veoSeconds(scene(words(13)))).toBe(6); // 5 s
    expect(veoSeconds(scene(words(15)))).toBe(6); // ≈5.8 s
    expect(veoSeconds(scene(words(16)))).toBe(8); // ≈6.2 s needs the 8 s clip
    expect(veoSeconds(scene(words(30)))).toBe(8);
  });

  it("charges a picture per rendered scene plus Veo seconds, and nothing for stock videos", () => {
    const scenes = [scene(words(10)), scene(""), scene(words(13)), scene(words(30))];
    expect(aiVisualCredits(plan(scenes))).toBe(0);
    const ai = { characterIds: [], look: "anime", veoScenes: [2, 3] };
    // 3 renderable scenes (the blank one is skipped); Veo on scenes 2 (6 s) and 3 (8 s)
    expect(aiVisualCredits(plan(scenes, ai))).toBe(3 * CREDIT_COST.aiImage + (6 + 8) * CREDIT_COST.veoSecond);
    expect(renderCredits(plan(scenes, ai))).toBe(videoCredits("s60", "render") + aiVisualCredits(plan(scenes, ai)));
  });

  it("keeps every AI price above Google's list price (1 credit ≈ 2¢)", () => {
    expect(CREDIT_COST.aiImage * 2).toBeGreaterThan(5.04); // Nano Banana 2.1, 2K picture
    expect(CREDIT_COST.veoSecond * 2).toBeGreaterThan(10); // Veo 3.1 Fast, 720p, per second
    expect(CREDIT_COST.character * 2).toBeGreaterThan(5.04 + 1);
  });

  it("estimates a range that covers the cheapest and the most expensive script", () => {
    const e = movieEstimate("s60", 3);
    expect(e.low).toBe(videoCredits("s60", "plan") + videoCredits("s60", "render") + 9 * CREDIT_COST.aiImage + 3 * 4 * CREDIT_COST.veoSecond);
    expect(e.high).toBe(videoCredits("s60", "plan") + videoCredits("s60", "render") + 12 * CREDIT_COST.aiImage + 3 * 8 * CREDIT_COST.veoSecond);
  });
});

describe("which scenes Veo animates", () => {
  const p = plan([scene("a"), scene(""), scene("b"), scene("c"), scene("d"), scene("e")]);
  it("takes the writer's key scenes first and skips blank or unknown ones", () => {
    expect(pickVeoScenes(p, [4, 2, 99, 4], 2)).toEqual([2, 3]); // scene 4 first, then the evenly spaced pick
  });
  it("spreads the rest evenly, never repeats, and never exceeds the scenes available", () => {
    expect(pickVeoScenes(p, [], 2)).toEqual([2, 4]);
    expect(pickVeoScenes(p, [1], 3)).toEqual([0, 3, 5]);
    expect(pickVeoScenes(p, [], 50)).toEqual([0, 2, 3, 4, 5]);
    expect(pickVeoScenes(p, [3], 0)).toEqual([]);
  });
});

describe("reading Gemini's answers", () => {
  it("finds the picture in the Interactions and generateContent shapes", () => {
    expect(findImage({ output_image: { data: PNG, mime_type: "image/png" } })).toEqual({ mimeType: "image/png", base64: PNG });
    expect(findImage({ steps: [{ type: "model_output", content: [{ type: "text", text: "Here" }, { type: "image", data: PNG }] }] })?.base64).toBe(PNG);
    expect(findImage({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/jpeg", data: PNG } }] } }] })).toEqual({ mimeType: "image/jpeg", base64: PNG });
    expect(findImage({ candidates: [{ content: { parts: [{ text: "I can't draw that." }] }, finishReason: "SAFETY" }] })).toBeNull();
  });

  it("explains the problems only the owner can fix", () => {
    expect(googleProblem(403, "PERMISSION_DENIED")).toMatch(/rejected the Gemini key/);
    expect(googleProblem(400, "This model requires billing to be enabled")).toMatch(/billing/);
    expect(googleProblem(429, "RESOURCE_EXHAUSTED quota per day")).toMatch(/daily allowance/);
    expect(googleProblem(429, "RESOURCE_EXHAUSTED try later")).toBeNull();
    expect(googleProblem(500, "internal")).toBeNull();
  });
});

describe("talking to Google", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("falls back to generateContent and then to the next picture model", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      if (calls.length <= 2) return json({ error: { message: "model not found" } }, 404); // 2.1 missing on both APIs
      if (url.endsWith("/interactions")) return json({ error: { message: "Invalid JSON payload" } }, 400);
      return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG } }] } }] });
    }));
    const img = await geminiImage({ prompt: "a fox", refs: [{ mimeType: "image/png", base64: PNG }], aspect: "9:16" });
    expect(img.bytes.equals(Buffer.from(PNG, "base64"))).toBe(true);
    expect(calls.map((c) => c.url.replace(/^.*v1beta\//, ""))).toEqual([
      "interactions",
      "models/gemini-nano-banana-2.1:generateContent",
      "interactions",
      "models/gemini-3.1-flash-image:generateContent",
    ]);
    expect(calls[0].body).toMatchObject({ model: "gemini-nano-banana-2.1", response_format: { type: "image", aspect_ratio: "9:16", image_size: "2K" } });
    expect(calls[3].body).toMatchObject({ generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "2K" } } });
  });

  it("starts a Veo job from the picture, waits for it, and downloads the clip", async () => {
    let polls = 0;
    const started: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(":predictLongRunning")) {
        started.push(JSON.parse(String(init?.body)));
        return json({ name: "models/veo-3.1-fast-generate-preview/operations/op1" });
      }
      if (url.endsWith("/operations/op1")) {
        polls++;
        return json(polls < 2 ? { done: false } : { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example/clip.mp4" } }] } } });
      }
      if (url === "https://files.example/clip.mp4") return new Response("MP4DATA");
      return json({}, 500);
    }));
    const clip = await veoClip({ prompt: "slow push-in", start: { mimeType: "image/png", base64: PNG }, aspect: "9:16", seconds: 6 });
    expect(clip.toString()).toBe("MP4DATA");
    expect(polls).toBe(2);
    expect(started[0]).toMatchObject({
      instances: [{ prompt: "slow push-in", image: { inlineData: { mimeType: "image/png", data: PNG } } }],
      parameters: { aspectRatio: "9:16", durationSeconds: "6", resolution: "720p", personGeneration: "allow_adult" },
    });
  });

  it("reports a clip Google's safety filter declined", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith(":predictLongRunning")
        ? json({ name: "op2", done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["contains a celebrity"] } } })
        : json({}, 500),
    ));
    await expect(veoClip({ prompt: "x", start: { mimeType: "image/png", base64: PNG }, aspect: "9:16", seconds: 4 })).rejects.toThrow(/safety filter declined this clip: contains a celebrity/);
  });
});

describe("explanations", () => {
  it("keeps only well-formed parts and turns them into plain text", () => {
    const e = cleanExplanation({
      title: "Compound interest",
      summary: "Interest earns interest.",
      explanation: ["First paragraph.", 42, ""],
      keyPoints: ["Start early"],
      glossary: [{ term: "APR", meaning: "Yearly rate" }, { term: "", meaning: "dropped" }, "junk"],
      example: "For example, $100 at 10%…",
      caveats: "not a list",
    });
    expect(e.explanation).toEqual(["First paragraph."]);
    expect(e.glossary).toEqual([{ term: "APR", meaning: "Yearly rate" }]);
    expect(e.caveats).toEqual([]);
    const text = explanationText(e);
    expect(text.startsWith("Compound interest\n\nInterest earns interest.")).toBe(true);
    expect(text).toContain("• Start early");
    expect(text).toContain("• APR: Yearly rate");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("refuses an empty answer", () => {
    expect(() => cleanExplanation({ title: "x" })).toThrow(/came back empty/);
  });
});

describe("art styles", () => {
  it("offers realistic people first, then graphics and animation, and gives realistic looks extra direction", async () => {
    const { CHARACTER_LOOK_GROUPS, CHARACTER_LOOKS, isRealisticLook } = await import("@/lib/characters");
    expect(CHARACTER_LOOK_GROUPS.map((g) => g.label)).toEqual(["Realistic people", "Graphics", "Animated and illustrated"]);
    expect(isRealisticLook(CHARACTER_LOOKS[0])).toBe(true); // the default is photorealistic
    for (const l of CHARACTER_LOOK_GROUPS[0].looks) expect(isRealisticLook(l)).toBe(true);
    for (const l of [...CHARACTER_LOOK_GROUPS[1].looks, ...CHARACTER_LOOK_GROUPS[2].looks]) expect(isRealisticLook(l)).toBe(false);
    expect(isRealisticLook("Cinematic photorealistic film still")).toBe(true); // characters saved with the old look keep realism
  });
});
