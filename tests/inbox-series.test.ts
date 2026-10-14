import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Isolated file-backed database for this test.
const dir = mkdtempSync(path.join(tmpdir(), "nexus-inbox-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
delete process.env.SUPABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.CONTENT_INBOX;

const VIDEO = "https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-content/media/the-settlement/voiced/ep01.mp4";

const episode = (n: number) => ({
  id: `the-settlement-s1e${String(n).padStart(2, "0")}`,
  name: "The Settlement",
  season: 1,
  episode: n,
  title: n === 1 ? "The Keys" : `Episode title ${n}`,
  logline: "He gave her the keys to everything.",
  nextTime: "Marcus starts losing things.",
  videoUrl: n === 1 ? VIDEO : VIDEO.replace("ep01", `ep${String(n).padStart(2, "0")}`),
  durationSec: 173,
  caption: "THE SETTLEMENT · Episode 1. A fictional story.",
  hashtags: ["TheSettlement", "#drama"],
  platforms: ["instagram", "facebook"],
  scenes: [
    { heading: "COLD OPEN. EXT. I-45 — NIGHT", time: "0:00", text: "Rain.\n\nMARCUS (V.O.): They say a man can feel it." },
    { heading: "INT. GRANT HOUSE — MORNING", time: "0:21", text: "TASHA: I got the bills, baby." },
  ],
});

let owner: { id: string };

beforeAll(async () => {
  const { createUser } = await import("@/lib/auth");
  owner = await createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
  const inbox = { batches: [], series: [episode(2), episode(1), { id: "broken-episode", name: "X" }] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(inbox), { status: 200, headers: { "content-type": "application/json" } })));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("content inbox: series episodes", () => {
  it("adds each episode to Story Studio and makes Instagram + Facebook video drafts with the finished video", async () => {
    const { importInbox } = await import("@/lib/inbox");
    const res = await importInbox();
    expect(res.stories).toBe(2);
    expect(res.imported).toBe(4);
    expect(res.errors.some((e) => e.startsWith("broken-episode"))).toBe(true);

    const { asUser, db } = await import("@/lib/db");
    const { listPosts } = await import("@/lib/repo");
    await asUser(owner.id, async () => {
      const stories = await db().all<import("@/lib/types").Story>("stories", 50);
      expect(stories).toHaveLength(2);
      // Episode 1 is imported last, so it is the newest and opens first.
      expect(stories[0].series?.episode).toBe(1);
      expect(stories[0].format).toBe("episode");
      expect(stories[0].type).toBe("fiction");
      expect(stories[0].videoUrl).toBe(VIDEO);
      expect(stories[0].out.scenes[0].heading).toContain("COLD OPEN");
      expect(stories[0].out.scenes[0].narration).toContain("MARCUS (V.O.)");

      const posts = await listPosts();
      const ep1 = posts.filter((p) => p.videoUrl === VIDEO);
      expect(ep1.map((p) => p.platform).sort()).toEqual(["facebook", "instagram"]);
      for (const p of ep1) {
        expect(p.kind).toBe("video");
        expect(p.status).toBe("draft");
        expect(p.video?.style).toBe("fiction");
        expect(p.video?.length).toBe("m3");
        expect(p.render?.status).toBe("done");
        expect(p.hashtags).toContain("drama");
        expect(p.safetyFlags.filter((f) => f.startsWith("block:"))).toEqual([]);
      }
    });

    // Running again imports nothing new.
    const again = await importInbox();
    expect(again.imported).toBe(0);
  });

  it("only trusts https MP4 links on the inbox host", async () => {
    const { trustedVideoUrl } = await import("@/lib/media");
    expect(trustedVideoUrl(VIDEO)).toBe(VIDEO);
    expect(trustedVideoUrl("http://raw.githubusercontent.com/a/b.mp4")).toBeNull();
    expect(trustedVideoUrl("https://evil.example.com/a.mp4")).toBeNull();
    expect(trustedVideoUrl("https://raw.githubusercontent.com/a/b.exe")).toBeNull();
  });
});
