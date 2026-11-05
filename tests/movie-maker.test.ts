import { describe, expect, it } from "vitest";
import { dialogueCaption, effectsFor, filmSpec, moveFor, movieCredits, parsePlan, picturePrompt, sceneFrom, spokenText } from "@/lib/movie-maker";

const PLAN = `VIDEO PLAN — TikTok · 3 minutes · vertical

TITLE OPTIONS:
1. Glass Tongue: The Soul Archivist of North Philly
2. He Stole from the House of Bottled Dead

THUMBNAIL: "BOTTLED SOULS" — An extreme close-up through thick antique glass filled with amber brine
VOICE: Deep, weathered, gravelly East Coast baritone
MUSIC & SOUND: Low droning cello beneath a bowed metallic rasp

SCENES:
1. [0:00–0:05] K-Von jammed the chrome barrel beneath Trey’s jaw.
   On screen: Midnight deadline.
   Visual: Low-angle medium close-up of a terrified young man pinned against a frosted green dumpster, 85mm lens.
   Edit: Slow tight push-in on the trembling jawline  ·  SFX: Muffled winter wind, metallic click
2. [0:05–0:09] K-Von: "You settle Dante’s street debt by midnight, or your house catches fire."
   On screen: Pay or burn.
   Visual: Over-the-shoulder close-up of a young man in a white beanie, cold vapor trailing from his mouth.
   Edit: Slight handheld sway maintaining eye contact  ·  SFX: Wood splintering snap
3. [0:09–0:13] The ghost wheezed, violently rattling the china cabinet.
   On screen: It wakes.
   Visual: A gray vaporous mass drifting behind a man in a dark parlor.
   Edit: Whip-pan following the vapor slamming into K-Von  ·  SFX: Teacups chatter
4. [0:13–0:17] Deep in the cellar, hundreds of jars began violently shaking.
   On screen: Breach.
   Visual: Shelves of glass jars shaking in a cellar.
   Edit: Rapid camera tremor simulating an earthquake  ·  SFX: Glass rattle

CAPTION:
Fiction. Follow for Part 2.

#shortfilm`;

describe("Movie Maker plan parsing", () => {
  const plan = parsePlan(PLAN);
  it("reads the title, look, voice, music and caption", () => {
    expect(plan.title).toBe("Glass Tongue: The Soul Archivist of North Philly");
    expect(plan.look).toMatch(/^An extreme close-up/);
    expect(plan.voice).toMatch(/baritone/);
    expect(plan.music).toMatch(/cello/);
    expect(plan.caption).toMatch(/^Fiction/);
  });
  it("reads every scene with its lines and timing", () => {
    expect(plan.scenes).toHaveLength(4);
    const [a, b] = plan.scenes;
    expect(a.onScreen).toBe("Midnight deadline.");
    expect(a.visual).toMatch(/^Low-angle/);
    expect(a.edit).toBe("Slow tight push-in on the trembling jawline");
    expect(a.sfx).toBe("Muffled winter wind, metallic click");
    expect(a.seconds).toBe(5);
    expect(b.seconds).toBe(4);
  });
  it("picks camera moves and effects from the words", () => {
    const [a, b, c, d] = plan.scenes;
    expect(a.move).toBe("push_in");
    expect(a.effects).toContain("frost");
    expect(b.move).toBe("handheld");
    expect(b.effects).toContain("steam");
    expect(c.effects).toContain("ghost");
    expect(c.effects).toContain("whip_in");
    expect(d.effects[0]).toBe("quake");
    expect(a.frame).toBe("open");
    expect(b.frame).toBe("letterbox");
  });
  it("speaks dialogue without the speaker tag and captions it", () => {
    const b = plan.scenes[1];
    expect(spokenText(b)).toBe("You settle Dante’s street debt by midnight, or your house catches fire.");
    expect(dialogueCaption(b)).toMatch(/^K-Von: "/);
    expect(dialogueCaption(plan.scenes[0])).toBe("");
  });
  it("treats plain paragraphs as scenes", () => {
    const p = parsePlan("A storm hits the harbour.\n\nThe keeper climbs the stairs.");
    expect(p.scenes).toHaveLength(2);
    expect(p.scenes[1].visual).toBe("The keeper climbs the stairs.");
  });
});

describe("Movie Maker defaults and spec", () => {
  it("maps edit lines to moves", () => {
    expect(moveFor("Rapid crash zoom on the face")).toBe("crash_zoom");
    expect(moveFor("Slow tilt-up from cellar doors")).toBe("tilt_up");
    expect(moveFor("Downward crane shot")).toBe("crane_down");
    expect(moveFor("Smooth forward dolly")).toBe("dolly");
    expect(moveFor("Subtle circular pan around the jar")).toBe("circle");
    expect(moveFor("Slow macro pull-back")).toBe("pull_back");
    expect(moveFor("")).toBe("push_in");
  });
  it("keeps at most three word-picked effects", () => {
    expect(effectsFor({ visual: "fog frost salt ghost flicker dust", edit: "", sfx: "", narration: "" }).length).toBe(3);
  });
  it("cleans hand-edited scenes", () => {
    const s = sceneFrom({ narration: "x", seconds: 99, move: "nope" as never, effects: ["fog", "bad" as never] }, 1);
    expect(s.seconds).toBe(20);
    expect(s.move).toBe("push_in");
    expect(s.effects).toEqual(["fog"]);
  });
  it("builds the engine's film with title and end cards", () => {
    const plan = parsePlan(PLAN);
    const spec = filmSpec({ scenes: plan.scenes.map((s) => ({ ...s, image: "/x.png" })), grade: "noir", title: "Glass Tongue", endCard: "Follow for Part 2", fiction: true });
    expect(spec.scenes).toHaveLength(6);
    expect(spec.scenes[0]).toMatchObject({ image: null, title: "Glass Tongue" });
    expect(spec.scenes[1].effects).toContain("bars_open");
    expect(spec.scenes[2].effects).toContain("bars");
    expect(spec.scenes[2].caption).toMatch(/^K-Von/);
    expect(spec.scenes[5]).toMatchObject({ title: "Follow for Part 2" });
    expect(spec.fiction).toBe(true);
  });
  it("prices pictures and voice, never the render", () => {
    const plan = parsePlan(PLAN);
    plan.scenes[0].mediaId = "med_1";
    expect(movieCredits(plan, { aiImage: 4, speech: 4 }, false)).toBe(12);
    expect(movieCredits(plan, { aiImage: 4, speech: 4 }, true)).toBe(16);
  });
  it("asks for a clean film still without text", () => {
    expect(picturePrompt(parsePlan(PLAN).scenes[0], "amber brine")).toMatch(/No text/);
  });
});

describe("long episodes", () => {
  it("keeps up to 60 scenes and doesn't read a salt-and-pepper beard as falling salt", () => {
    const text = Array.from({ length: 55 }, (_, i) => `${i + 1}. [${Math.floor((i * 5) / 60)}:${String((i * 5) % 60).padStart(2, "0")}–${Math.floor(((i + 1) * 5) / 60)}:${String(((i + 1) * 5) % 60).padStart(2, "0")}] Line ${i + 1}.\n   Visual: Marcus (salt-and-pepper beard) mopping.\n   Edit: Slow push-in  ·  SFX: hum`).join("\n");
    const p = parsePlan(text);
    expect(p.scenes).toHaveLength(55);
    expect(p.scenes[0].effects).not.toContain("salt");
    expect(effectsFor({ visual: "falling white salt crystals", edit: "", sfx: "", narration: "" })).toContain("salt");
  });
});
