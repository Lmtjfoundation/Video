import { describe, expect, it } from "vitest";
import { allShots, motionPrompt, nameTags, normalizePlan, shotMax, stillPrompt } from "@/lib/episode-studio/plan";
import { buildTimeline, captionChunks, captions } from "@/lib/episode-studio/timeline";

const raw = {
  series: "Second Line",
  title: "Brass & Blood",
  logline: "Four friends turn to the street after a stray bullet.",
  accent: "#E8C470",
  narrator: { voice: "en-US-AndrewMultilingualNeural", rate: "+2%" },
  cast: [
    { key: "locs", name: 'Dashon "Locs" Batiste', label: "Locs", role: "21 · the leader", look: "a 21-year-old Black man with long thin dreadlocks, black hoodie", voice: "en-US-DavisNeural", rate: "0%" },
    { key: "JOJO", name: "Jojo", role: "15", look: "a 15-year-old Black boy, white t-shirt, gold chain", voice: "not-a-voice" },
    { key: "N", name: "Bad", look: "reserved key" },
  ],
  beats: [
    {
      name: "cold open",
      mood: "warm",
      super: { title: "The 7th Ward", sub: "New Orleans" },
      shots: [
        { id: "s01", cast: [], still: "parade under the overpass", motion: "the crowd dances", seconds: 4.5, line: { speaker: "N", text: "Super Sunday. The whole ward comes out." } },
        { id: "s02", cast: ["LOCS", "JOJO", "GHOST"], still: "Locs and Jojo laughing", motion: "they laugh", seconds: 9, line: { speaker: "LOCS", style: "shouting", text: "Jojo, come here!" }, talking: true, impacts: [1, 20] },
        { id: "s02", cast: ["JOJO"], still: "Jojo dancing", motion: "he dances in place", seconds: 1 },
        { id: "s04", cast: [], still: "", motion: "missing still" },
      ],
    },
    { name: "rain", mood: "not-a-mood", shots: [{ id: "s05", cast: [], still: "rain", motion: "rain falls", line: { speaker: "WHO", text: "nobody" } }] },
  ],
};

describe("normalizePlan", () => {
  const plan = normalizePlan(raw, "short");
  it("keeps valid cast, fixes keys and voices, drops the reserved narrator key", () => {
    expect(plan.cast.map((c) => c.key)).toEqual(["LOCS", "JOJO"]);
    expect(plan.cast[0].label).toBe("LOCS");
    expect(plan.cast[0].rate).toBe("+0%");
    expect(plan.cast[1].voice).toBe("en-US-DavisNeural"); // unknown voice → a default by the look's gender
  });
  it("makes shots filmable: unique ids, known cast, lengths the engine can make, valid lines", () => {
    const shots = allShots(plan);
    expect(shots.map((s) => s.id)).toEqual(["s01", "s02", "s02x", "s05"]);
    expect(shots[1].cast).toEqual(["LOCS", "JOJO"]);
    expect(shots[1].seconds).toBe(shotMax(5.04)); // 9 s → the engine's limit, less the trim margin
    expect(shots[2].seconds).toBe(2.4);
    expect(shots[1].line).toEqual({ speaker: "LOCS", style: "shouting", text: "Jojo, come here!" });
    expect(shots[1].talking).toBe(true);
    expect(shots[1].impacts).toEqual([1]); // 20 s is past the end of the shot
    expect(shots[3].line).toBeUndefined(); // unknown speaker
    expect(plan.beats[1].mood).toBe("golden");
  });
  it("adds a series title card after the cold open when the writer forgot one", () => {
    expect(plan.beats[1].card).toEqual({ title: "SECOND LINE", sub: "BRASS & BLOOD", seconds: 3.5, style: "series" });
  });
  it("never asks the engine for more than its 5.04-second clips", () => {
    expect(shotMax(5.04) + 0.15).toBeLessThanOrEqual(5.04);
  });
  it("refuses a plan with nothing to film", () => {
    expect(() => normalizePlan({ beats: [] }, "short")).toThrow(/no shots/);
  });
  it("ties each person in a still to their reference image and keeps people moving in place", () => {
    const s = allShots(plan)[1];
    expect(stillPrompt(plan, s)).toContain("Image 1 is LOCS: a 21-year-old Black man");
    expect(stillPrompt(plan, s)).toContain("Image 2 is JOJO");
    expect(motionPrompt(s)).toMatch(/stay in place/);
    expect(motionPrompt(s, 1)).toMatch(/^Continuous, clearly visible natural movement/);
  });
  it("tags each character once, on their first appearance", () => {
    expect(nameTags(plan)).toEqual({ s02: { name: 'DASHON "LOCS" BATISTE', role: "21 · THE LEADER" }, s02x: { name: "JOJO", role: "15" } });
  });
});

describe("buildTimeline", () => {
  const plan = normalizePlan(raw, "short");
  it("places lines inside their shots, stretches a beat to hold them and caps every shot at the engine's limit", () => {
    const tl = buildTimeline(plan, { s01: 6, s02: 2 }, 4.89);
    const shots = tl.items.filter((i) => i.kind === "shot");
    expect(tl.voices[0]).toEqual({ id: "s01", start: 0.3, dur: 6 });
    expect(tl.voices[1].start).toBeGreaterThanOrEqual(6.55); // never over the line before it
    for (const s of shots) expect(s.dur).toBeLessThanOrEqual(4.89);
    const card = tl.items.find((i) => i.kind === "card")!;
    expect(card.start).toBeCloseTo(shots.filter((s) => s.beat === "cold open").reduce((a, s) => a + s.dur, 0), 2);
    expect(tl.total).toBeGreaterThanOrEqual(tl.voices[1].start + tl.voices[1].dur);
  });
  it("labels captions with the speaker and not the narrator", () => {
    const tl = buildTimeline(plan, { s01: 3, s02: 2 }, 4.89);
    const caps = captions(plan, tl);
    expect(caps[0].speaker).toBeNull();
    expect(caps.find((c) => c.text.startsWith("Jojo"))?.speaker).toBe("LOCS");
  });
});

describe("captionChunks", () => {
  it("never splits at an ellipsis or after St.", () => {
    expect(captionChunks("Man, that ain't... that's... come on, officer.")).toEqual(["Man, that ain't... that's... come on, officer."]);
    expect(captionChunks("On the ride home down St. Bernard Avenue, nobody said a word.")).toEqual(["On the ride home down St. Bernard Avenue, nobody said a word."]);
  });
  it("groups short sentences and halves long ones", () => {
    expect(captionChunks("Six hours in this room. Not one detective. Not one. That's how much our babies are worth to them.")).toEqual([
      "Six hours in this room. Not one detective. Not one.",
      "That's how much our babies are worth to them.",
    ]);
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.";
    expect(captionChunks(long)).toHaveLength(2);
  });
});
