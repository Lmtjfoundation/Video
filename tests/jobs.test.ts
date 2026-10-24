import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Post } from "@/lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-jobs-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
};

function videoPost(id: string, render?: Post["render"]): Post {
  const t = new Date().toISOString();
  return {
    id, platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "Twelve Years", body: "", parts: [], hashtags: [],
    status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t, render,
  };
}

describe("background jobs", () => {
  it("returns at once, runs as the person, and follows the video through its render", async () => {
    const { asUser, currentUserId } = await import("@/lib/db");
    const { savePost } = await import("@/lib/repo");
    const { startJob, jobViews } = await import("@/lib/jobs");
    const user = "usr_jobs";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ranAs: string | null = null;

    const job = await asUser(user, () =>
      startJob(user, { kind: "movie", title: "A movie" }, async () => {
        ranAs = currentUserId();
        await gate;
        const post = videoPost("post_job", { status: "rendering", progress: 40, message: "Rendering scene 2 of 5…", updatedAt: new Date().toISOString() });
        await savePost(post);
        return { post };
      }),
    );
    expect(job.status).toBe("queued");

    await asUser(user, async () => {
      await until(async () => (await jobViews())[0]?.status === "running");
      release();
      // The script is written but the video is still rendering: the tray shows the render's progress.
      await until(async () => (await jobViews())[0]?.progress === 40);
      const v = (await jobViews())[0];
      expect(v).toMatchObject({ status: "running", message: "Rendering scene 2 of 5…", title: "Twelve Years", href: "/post/post_job" });
      expect(ranAs).toBe(user);

      await savePost(videoPost("post_job", { status: "done", progress: 100, message: "42s · voiceover", updatedAt: new Date().toISOString() }));
      expect((await jobViews())[0]).toMatchObject({ status: "done", progress: 100, message: "42s · voiceover" });
    });
    // Another person's tray doesn't see it.
    expect(await asUser("usr_other", () => jobViews())).toEqual([]);
  });

  it("reports a failure in plain words, and clears finished jobs", async () => {
    const { asUser } = await import("@/lib/db");
    const { startJob, jobViews, clearFinished } = await import("@/lib/jobs");
    await asUser("usr_jobs_2", async () => {
      await startJob("usr_jobs_2", { kind: "audio", title: "Audio to video" }, async () => {
        throw new Error("That recording is 12:30 long. Audio to video takes up to 10:00.");
      });
      await until(async () => (await jobViews())[0]?.status === "failed");
      expect((await jobViews())[0].message).toContain("12:30");
      await clearFinished();
      expect(await jobViews()).toEqual([]);
    });
  });

  it("marks a job that a server restart cut off as failed", async () => {
    const { asUser } = await import("@/lib/db");
    const { kvSet } = await import("@/lib/repo");
    const { jobViews } = await import("@/lib/jobs");
    await asUser("usr_jobs_3", async () => {
      const old = new Date(Date.now() - 120_000).toISOString();
      await kvSet("jobs", [{ id: "job_lost", kind: "video", title: "Lost", status: "running", message: "Writing…", createdAt: old, updatedAt: old }]);
      const [v] = await jobViews();
      expect(v.status).toBe("failed");
      expect(v.message).toContain("restarted");
    });
  });
});
