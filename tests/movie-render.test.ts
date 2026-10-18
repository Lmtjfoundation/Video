import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Post, VideoScene } from "@/lib/types";

/**
 * End to end with the real ffmpeg: a two-scene movie whose pictures come from "Gemini" and whose second scene is
 * animated by "Veo" (Google's answers are simulated; everything after them is real). Skipped where ffmpeg isn't installed.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(path.join(tmpdir(), "nexus-movie-render-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "ELEVENLABS_API_KEY", "PIXABAY_API_KEY", "PEXELS_API_KEY", "GEMINI_IMAGE_MODEL", "VEO_MODEL"]) delete process.env[k];
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.RENDER_PRESET = "ultrafast";

vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

describe.skipIf(!hasFfmpeg)("rendering a movie with AI pictures and a Veo clip", () => {
  const realFetch = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  let png = "";
  let mp4: Buffer;

  beforeAll(() => {
    const still = path.join(dir, "still.png");
    const clip = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=768x1376", "-frames:v", "1", still], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=24", "-t", "2", "-pix_fmt", "yuv420p", clip], { stdio: "ignore" });
    png = readFileSync(still).toString("base64");
    mp4 = readFileSync(clip);
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/interactions")) return json({ output_image: { data: png, mime_type: "image/png" } });
      if (url.endsWith(":predictLongRunning")) return json({ name: "ops/1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example/v.mp4" } }] } } });
      if (url === "https://files.example/v.mp4") return new Response(new Uint8Array(mp4));
      return new Response("not mocked", { status: 500 });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("pictures every scene with the character, animates the Veo scene, and attaches the MP4", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { createCharacter } = await import("@/lib/characters");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const userId = "usr_movie_test";

    await asUser(userId, async () => {
      const maya = await createCharacter(userId, { name: "Maya", description: "Curly black hair, round glasses, green jacket", look: "Anime" });
      const scene = (narration: string, cast: string[]): VideoScene => ({ time: "", narration, onScreen: "", visual: "Maya at a window at dawn", motion: "slow push-in", sfx: "", cast });
      const t = new Date().toISOString();
      const post: Post = {
        id: "post_movie", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "The plant that never lies", body: "", parts: [], hashtags: [],
        status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
        video: {
          niche: "Short film", style: "fiction", length: "s30", titles: ["The plant that never lies"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [],
          scenes: [scene("Maya woke up early.", ["Maya"]), scene("The plant spoke first.", [])],
          ai: { characterIds: [maya.id], look: "Anime", veoScenes: [1] },
        },
      };
      await savePost(post);
      await renderVideoPost(userId, post.id, 0);

      const done = await db().get<Post>("posts", post.id);
      expect(done?.render?.status, done?.render?.message).toBe("done");
      expect(done?.render?.message).toContain("AI visuals");
      expect(done?.mediaIds?.[0]).toBe(done?.render?.mediaId);
    });

    const pictures = requests.filter((r) => r.url.endsWith("/interactions"));
    expect(pictures).toHaveLength(3); // the character portrait + one picture per scene
    const withMaya = pictures[1].body.input as { type: string }[];
    expect(withMaya.filter((p) => p.type === "image")).toHaveLength(1); // Maya's portrait guides her scene
    expect((pictures[2].body.input as { type: string }[]).filter((p) => p.type === "image")).toHaveLength(0);
    const veo = requests.find((r) => r.url.endsWith(":predictLongRunning"))!;
    expect(veo.body).toMatchObject({ instances: [{ image: { inlineData: { mimeType: "image/png", data: png } } }], parameters: { durationSeconds: "4", aspectRatio: "9:16" } });
  }, 120_000);
});
