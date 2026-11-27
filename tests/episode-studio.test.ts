import { describe, expect, it } from "vitest";
import { allShots, LAST_RESORT_TAKE, motionPrompt, nameTags, normalizePlan, omniPrompt, shotMax, stillPrompt } from "@/lib/episode-studio/plan";
import { omniRequest } from "@/lib/gemini-media";
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
        { id: "s01", cast: [], still: "parade under the overpass", motion: "the crowd dances", seconds: 4.5, line: { speaker: "N", text: "Super Sunday. The whole ward comes out." }, fx: ["Rain", "lens flare", "lasers", "fog", "dust", "embers"], transition: "Whip" },
        { id: "s02", cast: ["LOCS", "JOJO", "GHOST"], still: "Locs and Jojo laughing", motion: "they laugh", seconds: 9, line: { speaker: "LOCS", style: "shouting", text: "Jojo, come here!" }, talking: true, impacts: [1, 20] },
        { id: "s02", cast: ["JOJO"], still: "Jojo dancing", motion: "he dances in place", seconds: 1 },
        { id: "s04", cast: [], still: "", motion: "missing still" },
      ],
    },
    { name: "rain", mood: "not-a-mood", shots: [{ id: "s05", cast: [], still: "rain", motion: "rain falls", line: { speaker: "WHO", text: "nobody" }, transition: "cut" }] },
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
  it("keeps up to three known effects and a known transition; a plain cut needs no field", () => {
    const [s01, , , s05] = allShots(plan);
    expect(s01.fx).toEqual(["rain", "lens_flare", "fog"]);
    expect(s01.transition).toBe("whip");
    expect(s05.fx).toBeUndefined();
    expect(s05.transition).toBeUndefined();
    const withCard = normalizePlan({ ...raw, beats: [...raw.beats, { name: "later", mood: "night", card: { title: "Three days later", style: "card", transition: "dip-black" } }] }, "short");
    expect(withCard.beats.find((b) => b.name === "later")?.card?.transition).toBe("dip_black");
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
    // The last take asks for the simplest motion there is, so the shot still comes back as footage.
    expect(motionPrompt(s, LAST_RESORT_TAKE)).toMatch(/slow, steady camera push-in/);
    expect(motionPrompt(s, LAST_RESORT_TAKE)).not.toContain(s.motion);
  });
  it("tells Gemini what to avoid in the prompt (it has no negative prompt) and asks a talking face to speak", () => {
    const s = allShots(plan)[1];
    expect(omniPrompt(s)).toMatch(/Avoid: blurry, distorted face/);
    expect(omniPrompt(s)).toMatch(/lips and jaw moving/);
    expect(omniPrompt(allShots(plan)[0])).not.toMatch(/lips and jaw/);
  });
  it("tags each character once, on their first appearance", () => {
    expect(nameTags(plan)).toEqual({ s02: { name: 'DASHON "LOCS" BATISTE', role: "21 · THE LEADER" }, s02x: { name: "JOJO", role: "15" } });
  });
});

describe("omniRequest", () => {
  const start = { mimeType: "image/png", base64: "AAAA" };
  it("asks Gemini Omni for a 4K vertical clip of whole seconds, delivered as a file", () => {
    const b = omniRequest("gemini-omni-1.2-flash", { prompt: "He nods.", start, aspect: "9:16", seconds: 4.3, resolution: "4k" });
    expect(b.response_format).toEqual({ type: "video", aspect_ratio: "9:16", resolution: "4k", duration: "4s", delivery: "uri" });
    expect(b.input[0]).toEqual({ type: "image", mime_type: "image/png", data: "AAAA" });
    expect(b.input[1].text).toMatch(/^One continuous shot of 4 seconds/);
  });
  it("keeps the length inside Gemini's 3-15 seconds, 720p inline, and drops fields an older model rejects", () => {
    expect(omniRequest("m", { prompt: "", start, aspect: "16:9", seconds: 1 }).response_format).toEqual({ type: "video", aspect_ratio: "16:9", resolution: "720p", duration: "3s" });
    expect(omniRequest("m", { prompt: "", start, aspect: "16:9", seconds: 40, resolution: "1080p" }, ["duration", "delivery"]).response_format).toEqual({ type: "video", aspect_ratio: "16:9", resolution: "1080p" });
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
  it("carries a card's transition into the edit", () => {
    const withCard = normalizePlan({ ...raw, beats: [...raw.beats, { name: "later", mood: "night", card: { title: "Three days later", style: "card", transition: "dip_black" } }] }, "short");
    const tl = buildTimeline(withCard, { s01: 3, s02: 2 }, 4.89);
    expect(tl.items.find((i) => i.kind === "card" && i.text === "THREE DAYS LATER")?.transition).toBe("dip_black");
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
