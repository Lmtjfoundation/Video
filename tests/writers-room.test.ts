import { describe, expect, it, vi } from "vitest";

const replies: unknown[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/llm", () => ({
  claudeJson: vi.fn(async () => replies.shift()),
  claude: vi.fn(async () => replies.shift()),
}));

const dev = (summary2 = "Dre returns the ring.") => ({
  titles: ["The Settlement", "Split Keys", "What the House Keeps", "", "Equity"],
  logline: "A divorcing couple must sell the house where their son learned to walk.",
  theme: "Letting go is its own kind of love.",
  dramaticQuestion: "Will they let the house go?",
  world: { setting: "Third Ward, Houston", era: "Present day", rules: "Everyone knows everyone.", look: "Warm 35mm, low light", sound: "Sparse piano" },
  characters: [{ name: "Dre", role: "Lead", look: "Tall, gray hoodie", backstory: "Grew up here.", wound: "His father left.", want: "Keep the house", need: "Forgive himself", flaw: "Pride", arc: "From holding on to letting go", voice: "Short sentences", relationships: "Ex-husband of Tasha" }, { name: "" }],
  structure: [{ name: "Setup", summary: "The sign goes up." }],
  scenes: [
    { number: 1, heading: "INT. HOUSE — NIGHT", summary: "Dre paints the hallway.", purpose: "Show love", conflict: "Tasha wants to sell", turn: "He agrees to meet the realtor" },
    { number: 9, heading: "EXT. PORCH — DAY", summary: summary2, purpose: "Close", conflict: "Pride", turn: "He lets go" },
  ],
});

describe("Writers' Room", () => {
  it("develops, writes pages, reviews honestly, revises and builds the promotion kit", async () => {
    process.env.DATA_DIR = (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/nexus-writers-`);
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
    const { asUser } = await import("@/lib/db");
    const w = await import("@/lib/writers-room");
    await asUser("usr_writer", async () => {
      replies.push(dev());
      const f = await w.developFilm({ premise: "A couple splits a house", genre: "Drama", format: "short", tone: "" });
      expect(f.title).toBe("The Settlement");
      expect(f.titles).toHaveLength(4); // the empty option is dropped
      expect(f.characters.map((c) => c.name)).toEqual(["Dre"]); // nameless characters are dropped
      expect(f.scenes.map((s) => s.number)).toEqual([1, 2]); // renumbered in order
      await w.saveFilm(f);

      replies.push("### SCENE 1\nINT. HOUSE — NIGHT\n\nDre rolls paint.\n\n### SCENE 2\nEXT. PORCH — DAY\n\nThe ring.\n### SCENE 7\nnot asked for");
      await w.writePages(f, 1, 2);
      expect(Object.keys(f.pages).sort()).toEqual(["1", "2"]);
      expect(f.pages["1"]).toContain("Dre rolls paint.");

      replies.push({ verdict: "Promising, not there yet.", scores: [{ area: "Character depth", score: 14, note: "x" }, { area: "Theme", score: 0.4, note: "y" }], strengths: ["Specific world"], fixes: ["Give Tasha a want"], fit: ["Short film festivals"] });
      await w.reviewFilm(f);
      expect(f.review?.scores.map((s) => s.score)).toEqual([10, 1]); // clamped to 1–10

      // Revising changes scene 2's outline: its pages are cleared, scene 1's stay, and the old review is dropped.
      replies.push(dev("Tasha keeps the porch light on."));
      await w.reviseFilm(f, "Give Tasha a want");
      expect(Object.keys(f.pages)).toEqual(["1"]);
      expect(f.review).toBeUndefined();
      expect(f.notes).toEqual(["Give Tasha a want"]);

      replies.push({ tagline: "Some things don't split.", synopsis: "A couple…", posterPrompt: "Porch at dusk", trailer: ["A sign goes up"], characterSpotlights: [{ name: "Dre", caption: "Would you sell?" }], behindTheStory: "Why", hashtags: ["#film", "drama"] });
      await w.promoteFilm(f);
      expect(f.promo?.hashtags).toEqual(["film", "drama"]);
      expect(w.promoSource(f)).toContain("Some things don't split.");

      await w.saveFilm(f);
      expect((await w.listFilms())[0].promo?.tagline).toBe("Some things don't split.");
      await w.deleteFilm(f.id);
      expect(await w.listFilms()).toEqual([]);
    });
  });

  it("refuses an outline with no scenes", async () => {
    const { asUser } = await import("@/lib/db");
    const w = await import("@/lib/writers-room");
    await asUser("usr_writer", async () => {
      replies.push({ ...dev(), scenes: [] });
      await expect(w.developFilm({ premise: "x".repeat(20), genre: "Drama", format: "feature", tone: "" })).rejects.toThrow(/full outline/);
    });
  });
});
