import { describe, expect, it } from "vitest";
import { labGrade, labPlan } from "@/lib/video-lab";

describe("Video Lab", () => {
  it("asks for about one shot every 5 seconds and turns the answer into filmable scenes", async () => {
    let asked = "";
    const plan = await labPlan({ idea: "A second line parade at sunset in the Treme", length: "s30", style: "noir", cast: ["Locs"] }, (async (o: { user: string }) => {
      asked = o.user;
      return { title: "Sunset Second Line", caption: "#NOLA", scenes: [
        { narration: "The horns start low.", visual: "Brass band turning a corner, golden light", move: "track", effects: ["dust"], seconds: 5 },
        { narration: "Then the street answers.", visual: "Crowd dancing, umbrellas up", move: "not-a-move", effects: ["laser"], seconds: 50 },
      ] };
    }) as never);
    expect(asked).toMatch(/30-second video in exactly 6 shots/);
    expect(asked).toMatch(/Cast .*Locs/);
    expect(plan.title).toBe("Sunset Second Line");
    expect(plan.look).toMatch(/neo-noir/);
    expect(plan.scenes[0]).toMatchObject({ move: "track", effects: ["dust"], seconds: 5 });
    expect(plan.scenes[1].move).not.toBe("not-a-move"); // unknown moves fall back to a real one
    expect(plan.scenes[1].effects).not.toContain("laser");
    expect(plan.scenes[1].seconds).toBeLessThanOrEqual(20);
    expect(labGrade("classic")).toBe("noir");
  });

  it("explains when the AI writes no shots", async () => {
    await expect(labPlan({ idea: "anything at all here", length: "s15", style: "ad" }, (async () => ({ scenes: [] })) as never)).rejects.toThrow(/didn't write any shots/);
  });
});

describe("Video Lab long videos (up to 1 h 30 min)", () => {
  it("outlines one chapter per 5 minutes and writes each chapter with the story so far", async () => {
    const { labOutline, chapterPlan, longCredits, isLong, LAB_LENGTHS } = await import("@/lib/video-lab");
    expect(LAB_LENGTHS.m90).toBe(5400);
    expect(isLong("m5") && !isLong("s90")).toBe(true);
    const asks: string[] = [];
    const write = (async (o: { user: string }) => {
      asks.push(o.user);
      if (/Outline/.test(o.user)) return { title: "Second Line", chapters: Array.from({ length: 18 }, (_, i) => ({ title: `Part ${i + 1}`, summary: `Things happen in part ${i + 1}.` })) };
      return { scenes: Array.from({ length: 25 }, () => ({ narration: "A line.", visual: "A street at night.", seconds: 12 })) };
    }) as never;
    const outline = await labOutline({ idea: "Four friends in New Orleans", length: "m90", style: "noir" }, write);
    expect(asks[0]).toMatch(/90-minute video in exactly 18 chapters/);
    expect(outline.chapters).toHaveLength(18);
    const plan = await chapterPlan({ idea: "Four friends in New Orleans", length: "m90", style: "noir" }, outline, 5, write);
    expect(asks[1]).toMatch(/300-second video in exactly 25 shots/);
    expect(asks[1]).toMatch(/chapter 6 of 18/);
    expect(asks[1]).toMatch(/Story so far:[\s\S]*Part 4[\s\S]*Part 5/);
    expect(asks[1]).toMatch(/Next chapter \(Part 7\)/);
    expect(plan.scenes).toHaveLength(25);
    const last = await chapterPlan({ idea: "x x x x x x x x", length: "m90", style: "noir" }, outline, 17, write);
    expect(asks.at(-1)).toMatch(/final chapter/);
    expect(last.scenes.length).toBeGreaterThan(0);
    expect(longCredits("m90", true, { aiImage: 2, speech: 4 })).toBe(450 * 2 + Math.ceil((450 * 75) / 1000) * 4);
  });

  it("splits a long movie into chapters: title on the first, end card on the last, nothing lost", async () => {
    const { chaptersOf, CHAPTER_SCENES } = await import("@/lib/movie-maker-render");
    const { sceneFrom } = await import("@/lib/movie-maker");
    const scenes = Array.from({ length: 75 }, (_, i) => sceneFrom({ narration: `Line ${i}`, visual: "v", seconds: 10 }, i));
    const ch = chaptersOf({ plan: { title: "Big", look: "", voice: "", music: "", caption: "", scenes }, grade: "noir", characterIds: [], voice: true, endCard: "Fin", fiction: true });
    expect(ch.map((c) => c.plan.scenes.length)).toEqual([CHAPTER_SCENES, CHAPTER_SCENES, 15]);
    expect(ch.map((c) => c.plan.title)).toEqual(["Big", "", ""]);
    expect(ch.map((c) => c.endCard)).toEqual(["", "", "Fin"]);
    expect(ch.flatMap((c) => c.plan.scenes.map((s) => s.narration))).toEqual(scenes.map((s) => s.narration));
  });
});
