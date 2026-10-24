import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-series-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

// Claude is simulated: a 10-episode plan for the showrunner, a short script for each episode.
const asked: { system: string; user: string }[] = [];
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  claudeJson: async (o: { system: string; user: string }) => {
    asked.push(o);
    if (o.system.includes("showrunner")) {
      return {
        title: "The Settlement",
        logline: "She saved him. Then she sold him out.",
        bible: "Houston. Marcus, Tasha, Dre, Kev. $31,000 card. $20 million settlement.",
        episodes: Array.from({ length: 12 }, (_, i) => ({ title: `Ep ${i + 1}`, outline: `- beat for ${i + 1}`, hook: `hook ${i + 1}` })),
      };
    }
    return { titles: ["Twelve Years"], caption: "Fiction.", scenes: [{ narration: "Houston.", visual: "skyline", cast: ["Marcus", "Nobody"] }], keyScenes: [1] };
  },
}));

describe("Series Studio", () => {
  it("plans exactly the episodes asked for, keeps the cast, and writes each episode with what came before", async () => {
    const { asUser } = await import("@/lib/db");
    const { kvSet, getSettings } = await import("@/lib/repo");
    const { planSeries, episodeBrief, writeEpisode, listSeries } = await import("@/lib/series");
    await asUser("usr_series", async () => {
      await kvSet("characters", [{ id: "chr_m", name: "Marcus", description: "AC repairman", look: "Photorealistic", imageMediaId: "med_x", createdAt: new Date().toISOString() }]);
      const s = await planSeries({ premise: "A Houston family drama about a settlement.", episodes: 10, characterIds: ["chr_m", "chr_missing"], look: "Photorealistic", platform: "tiktok", length: "m3" });
      expect(s.episodes).toHaveLength(10); // the plan had 12; only the 10 asked for are kept
      expect(s.episodes.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(s.characterIds).toEqual(["chr_m"]);
      expect(asked[0].user).toContain("exactly 10");
      expect(asked[0].user).toContain("- Marcus: AC repairman");
      expect((await listSeries()).map((x) => x.id)).toEqual([s.id]);

      const brief = episodeBrief(s, 3);
      expect(brief).toContain("Episode 3 of 10");
      expect(brief).toContain("SERIES BIBLE");
      expect(brief).toContain('Episode 1, "Ep 1": ends on hook 1');
      expect(brief).toContain('Episode 2, "Ep 2": ends on hook 2');
      expect(brief).not.toContain("Episode 4,");
      expect(brief).toContain("- beat for 3");
      expect(episodeBrief(s, 10)).toContain("This is the finale");

      const post = await writeEpisode(s, 3, await getSettings());
      expect(post.topic).toBe("The Settlement · Episode 3: Ep 3");
      expect(post.video?.ai?.characterIds).toEqual(["chr_m"]);
      expect(post.video?.scenes[0].cast).toEqual(["Marcus"]); // unknown names are dropped
      expect(asked[asked.length - 1].user).toContain("THIS EPISODE, beat by beat");
    });
  });

  it("clamps the episode count to 3–20", async () => {
    const { asUser } = await import("@/lib/db");
    const { planSeries } = await import("@/lib/series");
    await asUser("usr_series_2", async () => {
      const big = await planSeries({ premise: "A long saga about a family business.", episodes: 50, characterIds: [], look: "Anime", platform: "youtube", length: "m3" });
      expect(big.episodes).toHaveLength(12); // asked for 20 (the cap); the simulated plan only has 12
      expect(asked[asked.length - 1].user).toContain("exactly 20");
    });
  });
});
