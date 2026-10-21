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
process.env.FREE_VOICE = "off"; // the free voice downloads a 90 MB model; tested on its own in free-voice.test.ts

vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

describe.skipIf(!hasFfmpeg)("rendering a movie with AI pictures and a Gemini clip", () => {
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
      const asks = (requests.at(-1)!.body.response_format as { type?: string } | undefined)?.type;
      if (url.endsWith("/interactions") && asks === "video") return json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: mp4.toString("base64") }] }] });
      if (url.endsWith("/interactions")) return json({ output_image: { data: png, mime_type: "image/png" } });
      if (url.endsWith(":predictLongRunning")) return json({ name: "ops/1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example/v.mp4" } }] } } });
      if (url === "https://files.example/v.mp4") return new Response(new Uint8Array(mp4));
      return new Response("not mocked", { status: 500 });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("pictures every scene with the character, animates the chosen scene with Gemini Omni Flash, and attaches the MP4", async () => {
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

    const isVideo = (r: (typeof requests)[number]) => (r.body.response_format as { type?: string } | undefined)?.type === "video";
    const pictures = requests.filter((r) => r.url.endsWith("/interactions") && !isVideo(r));
    expect(pictures).toHaveLength(3); // the character portrait + one picture per scene
    const withMaya = pictures[1].body.input as { type: string }[];
    expect(withMaya.filter((p) => p.type === "image")).toHaveLength(1); // Maya's portrait guides her scene
    expect((pictures[2].body.input as { type: string }[]).filter((p) => p.type === "image")).toHaveLength(0);
    const omni = requests.find((r) => r.url.endsWith("/interactions") && isVideo(r))!;
    expect(omni.body).toMatchObject({ model: "gemini-omni-1.1-flash", input: [{ type: "image", mime_type: "image/png", data: png }, { type: "text" }], response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p" } });
    expect(requests.some((r) => r.url.endsWith(":predictLongRunning"))).toBe(false); // Veo only when Omni isn't on the key
  }, 120_000);

  it("still finishes the movie when Google needs billing: backgrounds instead of AI pictures, credits back", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION", message: "billing required: free tier" } }), { status: 400 })) as typeof fetch;
    try {
      await asUser("usr_movie_test", async () => {
        const t = new Date().toISOString();
        const scene = (narration: string): VideoScene => ({ time: "", narration, onScreen: "", visual: "A porch at dusk", motion: "", sfx: "", cast: [] });
        const post: Post = {
          id: "post_movie_free", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Free tier", body: "", parts: [], hashtags: [],
          status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
          video: {
            niche: "Short film", style: "fiction", length: "s30", titles: ["Free tier"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [],
            scenes: [scene("The porch light stays on."), scene("Nobody is home.")],
            ai: { characterIds: [], look: "Photorealistic film still", veoScenes: [1] },
          },
        };
        await savePost(post);
        await renderVideoPost("usr_movie_test", post.id, 0);
        const done = await db().get<Post>("posts", post.id);
        expect(done?.render?.status, done?.render?.message).toBe("done");
        expect(done?.render?.message).toMatch(/AI visuals were unavailable \(This Google model needs billing/);
        expect(done?.mediaIds?.[0]).toBe(done?.render?.mediaId);
      });
    } finally {
      globalThis.fetch = prev;
    }
  }, 120_000);

  it("draws Graphics-style movies with the free motion-graphics engine, without calling Google", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const prev = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    try {
      await asUser("usr_movie_test", async () => {
        const t = new Date().toISOString();
        const scene = (narration: string, onScreen: string): VideoScene => ({ time: "", narration, onScreen, visual: "", motion: "", sfx: "", cast: [] });
        const post: Post = {
          id: "post_motion", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Motion", body: "", parts: [], hashtags: [],
          status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
          video: {
            niche: "Explainer", style: "explainer", length: "s30", titles: ["Motion"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [],
            scenes: [scene("Credit scores run from 300 to 850.", "300 TO 850"), scene("Payment history counts most.", "PAY ON TIME")],
            ai: { characterIds: [], look: "Motion-graphics explainer, clean flat shapes and icons, bold color blocks", veoScenes: [] },
          },
        };
        await savePost(post);
        await renderVideoPost("usr_movie_test", post.id, 0);
        const done = await db().get<Post>("posts", post.id);
        expect(done?.render?.status, done?.render?.message).toBe("done");
        expect(done?.render?.message).toContain("motion graphics");
      });
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = prev;
    }
  }, 120_000);

  it("shows the cast member's portrait card in their motion-graphics scenes", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost, kvSet } = await import("@/lib/repo");
    const { storeFile } = await import("@/lib/media");
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => new Response("unexpected", { status: 500 })) as typeof fetch;
    const face = path.join(dir, "face.png");
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=red:s=400x400", "-frames:v", "1", face], { stdio: "ignore" });
    try {
      await asUser("usr_movie_test", async () => {
        const img = await storeFile("usr_movie_test", { name: "marcus.png", type: "image/png", bytes: readFileSync(face) });
        await kvSet("characters", [{ id: "chr_marcus", name: "Marcus", description: "HVAC repairman", look: "Photorealistic film still", imageMediaId: img.id, createdAt: new Date().toISOString() }]);
        const t = new Date().toISOString();
        const scene = (narration: string, cast: string[]): VideoScene => ({ time: "", narration, onScreen: "THE OFFER", visual: "", motion: "", sfx: "", cast });
        const post: Post = {
          id: "post_cast", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Cast", body: "", parts: [], hashtags: [],
          status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
          video: {
            niche: "Short film", style: "fiction", length: "s30", titles: ["Cast"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [],
            scenes: [scene("Marcus reads the letter.", ["Marcus"]), scene("Nobody else is home.", [])],
            ai: { characterIds: ["chr_marcus"], look: "Photorealistic film still", veoScenes: [] },
            visuals: "motion",
          },
        };
        await savePost(post);
        await renderVideoPost("usr_movie_test", post.id, 0);
        const done = await db().get<Post>("posts", post.id);
        expect(done?.render?.status, done?.render?.message).toBe("done");
        const item = await db().get<import("@/lib/types").MediaItem>("media", done!.render!.mediaId!);
        const { readFile } = await import("@/lib/media");
        const mp4 = path.join(dir, "cast.mp4");
        (await import("node:fs")).writeFileSync(mp4, await readFile(item!));
        // Centre of the card, one second in (after it has slid in): the portrait's red shows through in scene 1 only.
        const pixel = (t: number) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", mp4, "-vf", "crop=4:4:538:686,scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        const [r, g, b] = pixel(1);
        expect(r).toBeGreaterThan(180);
        expect(g + b).toBeLessThan(120);
        const total = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString());
        const [r2] = pixel(total - 0.3);
        expect(r2).toBeLessThan(180);
      });
    } finally {
      globalThis.fetch = prev;
    }
  }, 120_000);

  it("honours the render choices: motion graphics instead of AI pictures, and no voiceover", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const { renderCredits } = await import("@/lib/video-spec");
    const prev = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    delete process.env.FREE_VOICE; // the voice would be on, but this video turns it off
    try {
      await asUser("usr_movie_test", async () => {
        const t = new Date().toISOString();
        const scene = (narration: string): VideoScene => ({ time: "", narration, onScreen: "BIG IDEA", visual: "a city", motion: "", sfx: "", cast: [] });
        const video = {
          niche: "Short film", style: "fiction" as const, length: "s30" as const, titles: ["Choices"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [],
          scenes: [scene("One choice changes everything.")],
          ai: { characterIds: [], look: "Photorealistic film still", veoScenes: [0] },
          voiceover: false, visuals: "motion" as const,
        };
        expect(renderCredits(video)).toBeLessThan(renderCredits({ ...video, visuals: "auto" })); // no AI picture or Veo credits
        const post: Post = {
          id: "post_choices", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Choices", body: "", parts: [], hashtags: [],
          status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t, video,
        };
        await savePost(post);
        await renderVideoPost("usr_movie_test", post.id, 0);
        const done = await db().get<Post>("posts", post.id);
        expect(done?.render?.status, done?.render?.message).toBe("done");
        expect(done?.render?.message).toMatch(/captions only · motion graphics/);
      });
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = prev;
      process.env.FREE_VOICE = "off";
    }
  }, 120_000);
});
