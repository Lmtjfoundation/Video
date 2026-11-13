/**
 * The writing standard every fiction writer in Vueio works to (Writers' Room, series showrunner, short films and
 * movie scripts): the craft of a major-studio feature or a prestige TV drama, applied to short and long formats.
 * Pure strings, so the prompts that use them are unit-tested.
 */

export const SCREEN_CRAFT = [
  "Write to the standard of a major-studio feature and a top prestige TV drama: every frame should feel like it cost money and every line like it was fought over in the room.",
  "STORY: open cold, mid-action or mid-conflict, never on setup. Every scene has a want, an obstacle and a turn: someone enters wanting something and leaves with more or less than they came for. Raise the stakes every act. Plant early what pays off late. End every act and episode on a reversal or a question that has to be answered.",
  "CHARACTERS: each one has a public face and a private truth, a code they live by and the thing that will make them break it. Loyalty, ambition, family and money pull against each other. No one is purely good or purely evil; the antagonist believes they are right.",
  "DIALOGUE: people talk around what they mean. Each character sounds like only themselves: rhythm, slang, education, region and status show in every line, and they switch how they talk depending on who is listening. Short, loaded lines; threats delivered quietly; jokes that hide fear. Real language for the world, never caricature, never exposition dumps.",
  "PICTURE: write shots the way a director of photography would plan them: lens and framing (wide, close-up, over-the-shoulder, low angle), motivated light (neon, sodium street light, practical lamps, hard window light), camera movement with a reason, and one striking image per scene that could be the poster.",
  "SOUND: give every scene a sound idea (silence before violence, a bass line under a deal, a city that never stops) and a music cue for the big turns.",
  "CONSISTENCY: keep every character's name, look, wardrobe, voice and history identical from scene to scene and episode to episode unless the story deliberately changes them.",
].join("\n");

/** Genre styles with their own room voice. The keys are FILM_GENRES entries. */
export const GENRE_STYLE: Record<string, string> = {
  "Street crime saga":
    "STYLE: a gritty, glossy street-to-penthouse crime saga in the tradition of the best cable crime dramas: a protagonist living a double life between the legitimate world and the game, a family that is both the reason and the risk, partners who are one deal away from becoming enemies, cops and lawyers who are players too. Power is the real currency. Scenes cut between club, courtroom, kitchen table and corner. Sex, money and loyalty are leverage. Every episode ends with a betrayal revealed or a gun on the table. Original characters and plots only: the feel, never another show's people or storylines.",
  Blockbuster:
    "STYLE: a summer-tentpole studio feature: a clear goal with world-sized stakes, three escalating set pieces each bigger than the last, iconic hero moments built for the trailer, a villain with a plan that makes sense, humour that releases tension, and a final act that pays off every setup on screen.",
  Crime: "STYLE: procedural precision and moral weight: every clue is fair, every choice costs someone, and the city is a character.",
  Thriller: "STYLE: relentless tension: ticking clocks, information the audience has that the hero doesn't, and reversals at every act break.",
  Action: "STYLE: geography the audience can follow, physical stakes, and action that reveals character; every fight changes the story.",
};

/** The style line for a genre (empty when the genre has no special voice). */
export const genreStyle = (genre: string) => GENRE_STYLE[genre] ?? "";
