import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Post } from "@/lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-preview-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
};

describe("live preview", () => {
  it("keeps the pieces made inside a scope, the latest eight, for their owner only", async () => {
    const { showPreview, withPreview, previewLabel, listPreview, previewFile } = await import("@/lib/preview");
    // Outside a job or render nothing is kept.
    await showPreview({ bytes: PNG, mime: "image/png" });
    expect(await listPreview("usr_a", "job_1")).toEqual([]);

    await withPreview("usr_a", "job_1", async () => {
      await showPreview({ bytes: PNG, mime: "image/png", label: "Picture" });
      await previewLabel("Shot 2", () => showPreview({ bytes: Buffer.from("clip"), mime: "video/mp4" }));
      await showPreview({ bytes: Buffer.from("x"), mime: "application/pdf" }); // not a picture or clip: skipped
    });
    const items = await listPreview("usr_a", "job_1");
    expect(items.map((i) => [i.n, i.mime, i.label])).toEqual([[1, "image/png", "Picture"], [2, "video/mp4", "Shot 2"]]);
    expect((await previewFile("usr_a", "job_1", 2))?.mime).toBe("video/mp4");
    // Someone else asking for the same job sees nothing.
    expect(await listPreview("usr_b", "job_1")).toEqual([]);
    expect(await previewFile("usr_b", "job_1", 1)).toBeNull();

    // A file on disk (a rendered scene) is copied in; only the latest eight are kept.
    const scene = path.join(dir, "scene.mp4");
    writeFileSync(scene, "scene");
    await withPreview("usr_a", "job_1", async () => {
      for (let i = 0; i < 9; i++) await showPreview({ file: scene, mime: "video/mp4", label: `Scene ${i + 1}` });
    });
    const kept = await listPreview("usr_a", "job_1");
    expect(kept).toHaveLength(8);
    expect(kept.at(-1)).toMatchObject({ n: 11, label: "Scene 9" });
    expect(await previewFile("usr_a", "job_1", 1)).toBeNull(); // dropped, and its file removed
  });

  it("shows a job's pieces in the tray, then its video's render scenes", async () => {
    const { asUser } = await import("@/lib/db");
    const { savePost } = await import("@/lib/repo");
    const { startJob, jobViews } = await import("@/lib/jobs");
    const { showPreview, withPreview } = await import("@/lib/preview");
    const user = "usr_preview";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = new Date().toISOString();
    const post: Post = {
      id: "post_preview", platform: "tiktok", pillar: "ai_leverage", format: "video_script", kind: "video", hook: "JET", body: "", parts: [], hashtags: [],
      status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
      render: { status: "rendering", progress: 50, message: "Rendering scene 1 of 4…", updatedAt: t },
    };

    const job = await asUser(user, () =>
      startJob(user, { kind: "movie", title: "JET" }, async () => {
        await showPreview({ bytes: PNG, mime: "image/png", label: "Cast" });
        await gate;
        await savePost(post);
        return { post };
      }),
    );
    await asUser(user, async () => {
      await until(async () => !!(await jobViews())[0]?.preview);
      expect((await jobViews())[0].preview).toMatchObject({ key: job.id, items: [{ n: 1, label: "Cast" }] });
      release();
      await until(async () => (await jobViews())[0]?.progress === 50);
      // The render's scenes take over once there are some.
      await withPreview(user, post.id, () => showPreview({ bytes: Buffer.from("scene"), mime: "video/mp4", label: "Scene 1 of 4" }));
      expect((await jobViews())[0].preview).toMatchObject({ key: post.id, items: [{ n: 1, label: "Scene 1 of 4" }] });
    });
  });
});
