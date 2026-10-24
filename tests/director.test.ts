import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-director-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

// The writer is simulated: a 3-scene storyboard, then a revision that darkens scene 2 and adds an ending.
const asked: { system: string; user: string }[] = [];
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  claudeJson: async (o: { system: string; user: string }) => {
    asked.push(o);
    if (o.system.includes("film director")) {
      return {
        reply: "Scene 2 is darker now, and I added an ending with Dre.",
        scenes: [
          { narration: "Houston.", visual: "skyline at night", cast: [] },
          { narration: "He found a phone.", visual: "a dark closet, one blue glow", cast: ["Marcus"] },
          { narration: "Every key.", visual: "keys in a hand", cast: ["Marcus"] },
          { narration: "D.", visual: "Dre in a parked car, watching", cast: ["Dre", "Stranger"] },
        ],
      };
    }
    return {
      titles: ["One Contact"],
      caption: "Fiction.",
      scenes: [
        { narration: "Houston.", visual: "skyline at night", cast: [] },
        { narration: "He found a phone.", visual: "a closet", cast: ["Marcus"] },
        { narration: "Every key.", visual: "keys in a hand", cast: ["Marcus"] },
      ],
    };
  },
}));

describe("Director", () => {
  it("starts a storyboard from a message, changes it by conversation, and keeps pictures for unchanged shots", async () => {
    const { asUser } = await import("@/lib/db");
    const { kvSet, getPost, getSettings, savePost } = await import("@/lib/repo");
    const { startSession, revise, setScenes, getSession } = await import("@/lib/director");
    await asUser("usr_director", async () => {
      const t = new Date().toISOString();
      await kvSet("characters", [
        { id: "chr_m", name: "Marcus", description: "AC repairman", look: "Photorealistic", imageMediaId: "med_m", createdAt: t },
        { id: "chr_d", name: "Dre", description: "his old partner", look: "Photorealistic", imageMediaId: "med_d", createdAt: t },
      ]);
      const { session, post } = await startSession({ message: "Marcus finds a second phone. Rainy night.", characterIds: ["chr_m", "chr_d"], look: "Photorealistic", platform: "tiktok", length: "s60" }, await getSettings());
      expect(post.video?.scenes).toHaveLength(3);
      expect(session.messages.map((m) => m.role)).toEqual(["you", "director"]);
      expect(session.messages[1].text).toContain("3 scenes with Marcus, Dre");

      // Scene 3 already has a painted picture; scene 1 has one chosen by hand.
      const p = (await getPost(post.id))!;
      p.video!.scenes[0].mediaId = "med_mine";
      p.video!.scenes[2].painted = { mediaId: "med_painted", key: "k" };
      await savePost(p);

      const r = await revise((await getSession(session.id))!, "Make the closet darker and end on Dre watching");
      const scenes = r.post.video!.scenes;
      expect(scenes.map((s) => s.narration)).toEqual(["Houston.", "He found a phone.", "Every key.", "D."]);
      expect(scenes[0].mediaId).toBe("med_mine"); // same shot: the chosen picture stays
      expect(scenes[1].painted).toBeUndefined(); // the shot changed: it will be repainted
      expect(scenes[2].painted?.mediaId).toBe("med_painted");
      expect(scenes[3].cast).toEqual(["Dre"]); // names not in the cast are dropped
      expect(scenes[3].time).toMatch(/^\d:\d\d–\d:\d\d$/);
      expect(r.session.messages.at(-1)?.text).toContain("darker");
      expect(asked.at(-1)!.user).toContain("THE CREATOR NOW SAYS: Make the closet darker");

      // Timeline by hand: last scene first, a picture that isn't the person's is ignored.
      const reordered = [scenes[3], scenes[0], scenes[1]].map((s) => ({ ...s }));
      reordered[2].mediaId = "med_someone_else";
      const after = await setScenes(r.session, reordered, async (id) => id === "med_mine");
      expect(after.video!.scenes.map((s) => s.narration)).toEqual(["D.", "Houston.", "He found a phone."]);
      expect(after.video!.scenes[1].mediaId).toBe("med_mine");
      expect(after.video!.scenes[2].mediaId).toBeUndefined();
      await expect(setScenes(r.session, [], async () => true)).rejects.toThrow("at least one scene");
    });
  });
});
