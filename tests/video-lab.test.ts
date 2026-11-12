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
