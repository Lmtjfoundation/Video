import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, CREDIT_LABEL } from "@/lib/plans";

/** Customer-facing copy sells Ghost Post as its own studio: no AI vendor names (admin screens keep them). */
const VENDORS = /\b(Gemini|Google|Veo|ElevenLabs|Seedance|ByteDance|Replicate|OpenArt|Mootion|Artlist|Kokoro|Claude|Anthropic|Flux|Qwen|Wan 2|Chatterbox|ACE-Step|MuseTalk)\b/;

describe("own brand", () => {
  it("keeps vendor names off the showcase page, the plan copy and the customer engine pickers", () => {
    expect(readFileSync("src/app/welcome/page.tsx", "utf8")).not.toMatch(VENDORS);
    for (const k of CREDIT_PACKS) expect(k.label).not.toMatch(VENDORS);
    for (const v of Object.values(CREDIT_LABEL)) expect(v).not.toMatch(VENDORS);
    const movies = readFileSync("src/app/movies/page.tsx", "utf8");
    for (const line of movies.split("\n").filter((l) => /<option value=|engineName =|subtitle=/.test(l))) expect(line).not.toMatch(VENDORS);
    const film = readFileSync("src/app/film-engine/page.tsx", "utf8");
    for (const line of film.split("\n").filter((l) => /ENGINE_LABEL|subtitle=|ENGINES\.map/.test(l))) expect(line).not.toMatch(VENDORS);
  });
});
