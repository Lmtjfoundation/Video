import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Post, VideoScene } from "@/lib/types";

/**
 * Vueio makes motion graphics only, in 4K (src/lib/product.ts, the default): no cinematic tools in the menus, their
 * pages and API routes closed, and every video drawn by the motion-graphics engine at 2160×3840 or 3840×2160 even when
 * its plan asks for AI pictures, AI clips or the person's own footage.
 */
vi.hoisted(() => {
  delete process.env.NEXT_PUBLIC_VUEIO_CINEMATIC;
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-motion-only-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "ELEVENLABS_API_KEY", "PIXABAY_API_KEY", "PEXELS_API_KEY"]) delete process.env[k];
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.RENDER_PRESET = "ultrafast";
process.env.FREE_VOICE = "off";

describe("motion graphics only", () => {
  it("keeps the cinematic tools out of the menus and closes their pages and API routes", async () => {
    const { SECTIONS } = await import("@/lib/nav");
    const { MOTION_ONLY, isCinematicPath, videoSize } = await import("@/lib/product");
    expect(MOTION_ONLY).toBe(true);
    const make = SECTIONS.find((s) => s.key === "make")!;
    const hrefs = make.tools.map((t) => t.href);
    for (const gone of ["/video-lab", "/story-video", "/writers", "/series", "/movie-maker", "/movies", "/director", "/film-engine", "/stories", "/video-tools", "/video-tools?tab=music", "/voice-lab?tab=presenter"]) expect(hrefs).not.toContain(gone);
    expect(make.tools[0]).toMatchObject({ href: "/studio", label: "Motion Graphics Videos" });
    expect(hrefs).toEqual(expect.arrayContaining(["/images", "/voice-lab", "/create", "/explain"]));

    for (const p of ["/movies", "/film-engine/x", "/api/films", "/api/video-tools", "/api/series/episode"]) expect(isCinematicPath(p)).toBe(true);
    for (const p of ["/studio", "/make", "/api/generate", "/api/video/render", "/moviesx", "/api/previews/a"]) expect(isCinematicPath(p)).toBe(false);
    expect(videoSize(false)).toEqual([2160, 3840]);
    expect(videoSize(true)).toEqual([3840, 2160]);
  });

  it("refuses AI footage and charges nothing for AI visuals", async () => {
    const { aiVisualCredits } = await import("@/lib/video-spec");
    const { makeFootage } = await import("@/lib/sound-studio");
    const scene: VideoScene = { time: "", narration: "x", onScreen: "", visual: "", motion: "", sfx: "", cast: [] };
    expect(aiVisualCredits({ scenes: [scene, scene], ai: { characterIds: [], look: "Photoreal film still", veoScenes: [0] } })).toBe(0);
    await expect(makeFootage("usr_x", { prompt: "a city", aspect: "16:9", seconds: 3 })).rejects.toThrow(/motion graphics in 4K/);
  });

  it.skipIf(!hasFfmpeg)("falls back to the motion-graphics engine when the Azure scene renderer can't run", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const gemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY; // keyframes can't be painted, so the Azure path fails at its first step
    process.env.AZURE_SCENES_ACCOUNT = "vueioscfallback1";
    try {
      await asUser("usr_motion_fb", async () => {
        const t = new Date().toISOString();
        const post = {
          id: "post_motion_fb", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Fallback", body: "", parts: [], hashtags: [],
          status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
          video: { niche: "Explainer", style: "explainer", length: "s30", titles: ["Fallback"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [], voiceover: false,
            scenes: [{ time: "", narration: "Still finishes.", onScreen: "STILL", visual: "", motion: "", sfx: "", cast: [] }] },
        } as unknown as Post;
        await savePost(post);
        await renderVideoPost("usr_motion_fb", post.id, 0);
        const done = await db().get<Post>("posts", post.id);
        expect(done?.render?.status, done?.render?.message).toBe("done");
        expect(done?.render?.message).toMatch(/motion graphics/);
      });
    } finally {
      delete process.env.AZURE_SCENES_ACCOUNT;
      if (gemini) process.env.GEMINI_API_KEY = gemini;
    }
  }, 300_000);

  it.skipIf(!hasFfmpeg)("renders a video as 4K motion graphics even when its plan asks for AI pictures and its own footage", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const { storeFile, readFile } = await import("@/lib/media");
    const prev = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    try {
      await asUser("usr_motion", async () => {
        // The person's own clip, attached to the post: motion graphics are drawn instead.
        const clip = path.join(dir, "own.mp4");
        execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x568:r=24", "-t", "2", "-pix_fmt", "yuv420p", clip], { stdio: "ignore" });
        const own = await storeFile("usr_motion", { name: "own.mp4", type: "video/mp4", bytes: (await import("node:fs")).readFileSync(clip) });
        const t = new Date().toISOString();
        const scene = (narration: string): VideoScene => ({ time: "", narration, onScreen: "4K MOTION", visual: "a city at night", motion: "", sfx: "", cast: [] });
        const post: Post = {
          id: "post_motion", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Motion", body: "", parts: [], hashtags: [],
          status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
          mediaIds: [own.id],
          video: {
            niche: "Explainer", style: "explainer", length: "s30", titles: ["Motion"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [],
            scenes: [scene("Every frame is drawn.")],
            ai: { characterIds: [], look: "Photoreal film still", veoScenes: [0] },
            voiceover: false,
          },
        } as Post;
        await savePost(post);
        await renderVideoPost("usr_motion", post.id, 0);
        const done = await db().get<Post>("posts", post.id);
        expect(done?.render?.status, done?.render?.message).toBe("done");
        expect(done?.render?.message).toMatch(/motion graphics/);
        const item = await db().get<import("@/lib/types").MediaItem>("media", done!.render!.mediaId!);
        const mp4 = path.join(dir, "motion.mp4");
        writeFileSync(mp4, await readFile(item!));
        if (process.env.MOTION_SAMPLE) writeFileSync(process.env.MOTION_SAMPLE, await readFile(item!)); // a copy to look at
        const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", mp4]).toString().trim().split(",").map(Number);
        expect([w, h]).toEqual([2160, 3840]);
        // Not the red clip: the centre is the motion-graphics background.
        const [r, g, b] = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", mp4, "-vf", "crop=8:8:1076:1916,scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        expect(r > 200 && g < 60 && b < 60).toBe(false);
      });
      expect(calls).toBe(0); // no AI picture or clip service was asked
    } finally {
      globalThis.fetch = prev;
    }
  }, 300_000);
});
