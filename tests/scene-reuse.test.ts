import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Post, VideoScene } from "@/lib/types";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-scene-reuse-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ELEVENLABS_API_KEY", "PIXABAY_API_KEY", "PEXELS_API_KEY"]) delete process.env[k];
process.env.RENDER_PRESET = "ultrafast";
process.env.FREE_VOICE = "off";
process.env.VIDEO_ENGINE_URL = "https://gpu.example/";
process.env.VIDEO_ENGINE_TOKEN = "engine-token";
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

describe.skipIf(!hasFfmpeg)("re-rendering after a timeline edit", () => {
  it("repaints only the scenes that changed and uses a picture chosen for a scene", async () => {
    const png = path.join(dir, "frame.png");
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=288x512", "-frames:v", "1", png], { stdio: "ignore" });
    const bytes = readFileSync(png);
    const painted: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = new URL(String(url)).pathname;
      if (p === "/v1/images" && init?.method === "POST") {
        painted.push(JSON.parse(String(init.body)).prompt);
        return Response.json({ id: `img${painted.length}`, status: "queued" });
      }
      if (/^\/v1\/images\/img\d+$/.test(p)) return Response.json({ status: "succeeded" });
      if (/^\/v1\/images\/img\d+\/file$/.test(p)) return new Response(bytes, { headers: { "content-type": "image/png" } });
      return new Response("no", { status: 404 });
    });
    const { asUser, db } = await import("@/lib/db");
    const { renderVideoPost } = await import("@/lib/render");
    const { savePost } = await import("@/lib/repo");
    const { storeFile } = await import("@/lib/media");
    const userId = "usr_reuse";
    const scene = (narration: string, visual: string): VideoScene => ({ time: "", narration, onScreen: "", visual, motion: "", sfx: "" });

    await asUser(userId, async () => {
      const t = new Date().toISOString();
      const post: Post = {
        id: "post_reuse", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Twelve years", body: "", parts: [], hashtags: [],
        status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
        video: {
          niche: "Short film", style: "fiction", length: "s30", titles: ["Twelve years"], thumbnail: {}, voice: "", music: "", loopLine: "", factCheck: [], voiceover: false,
          scenes: [scene("Houston.", "skyline at night"), scene("He gave her every key.", "keys in a hand")],
          ai: { characterIds: [], look: "Photorealistic film still", veoScenes: [] },
        },
      };
      await savePost(post);
      const render = async () => {
        await renderVideoPost(userId, post.id, 0);
        const done = (await db().get<Post>("posts", post.id))!;
        expect(done.render?.status, done.render?.message).toBe("done");
        return done;
      };

      let done = await render();
      expect(painted).toHaveLength(2);
      expect(done.video!.scenes.every((s) => s.painted?.mediaId)).toBe(true);

      // Nothing changed: nothing is repainted.
      await render();
      expect(painted).toHaveLength(2);

      // Scene 2's shot changes: only scene 2 is repainted.
      done = (await db().get<Post>("posts", post.id))!;
      done.video!.scenes[1].visual = "keys on a kitchen table";
      await savePost(done);
      await render();
      expect(painted).toHaveLength(3);
      expect(painted[2]).toContain("keys on a kitchen table");

      // A picture chosen for scene 1 replaces its AI picture; scene 2 is reused.
      const mine = await storeFile(userId, { name: "mine.png", type: "image/png", bytes });
      done = (await db().get<Post>("posts", post.id))!;
      done.video!.scenes[0].mediaId = mine.id;
      done.video!.scenes[0].visual = "a brand-new shot that would otherwise be painted";
      await savePost(done);
      await render();
      expect(painted).toHaveLength(3);
    });
  }, 240_000);
});
