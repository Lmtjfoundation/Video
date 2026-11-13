import { describe, expect, it } from "vitest";
import { GENRE_STYLE, SCREEN_CRAFT, genreStyle } from "@/lib/screen-craft";

describe("screen craft", () => {
  it("covers story, character, dialogue, picture, sound and consistency", () => {
    for (const k of ["STORY:", "CHARACTERS:", "DIALOGUE:", "PICTURE:", "SOUND:", "CONSISTENCY:"]) expect(SCREEN_CRAFT).toContain(k);
  });
  it("has a voice for the new genres, and keeps originality rules", () => {
    expect(genreStyle("Street crime saga")).toMatch(/double life/);
    expect(genreStyle("Street crime saga")).toMatch(/Original characters and plots only/);
    expect(genreStyle("Blockbuster")).toMatch(/set pieces/);
    expect(genreStyle("Romance")).toBe("");
  });
  it("every styled genre is offered in the Writers' Room", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/writers-room.ts", "utf8");
    for (const g of Object.keys(GENRE_STYLE)) expect(src).toContain(`"${g}"`);
  });
});
