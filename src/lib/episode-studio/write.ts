import "server-only";
import { claudeJson } from "../llm";
import { DEFAULT_PREMIUM_MODEL } from "../plans";
import { ACTING_STYLES, EPISODE_LENGTHS, EPISODE_VOICES, MOODS, normalizePlan, type EpisodeAspect, type EpisodeLength, type EpisodePlan } from "./plan";

/**
 * The showrunner: turns a basic prompt into a plan that films well on an image-to-video model. The rules come from
 * what held up and what broke while making Second Line episode 1: people moving in place look human; spins, turns,
 * hugs and fights melt faces; every shot needs one clear action; lines must be short to caption and to fit a shot.
 */
const SYSTEM = `You are the showrunner, writer and director of an original short-form drama series filmed with AI. You turn a basic prompt into a complete, filmable episode plan, as JSON.

STORY
- Original fiction only: invent every character, place name and business. No real people, celebrities, brands, songs or existing franchises.
- Structure: a gripping cold open (the hook), then a title card, then the story in beats, ending on a cliffhanger. Then optionally a "next" card teasing the next episode.
- Violence and danger are implied, never shown graphically: show the before, the reaction and the aftermath. No gore, no sexual content, no minors in danger shown explicitly.

CAST
- 2 to 6 characters (1 to 4 for a teaser). Each gets: key (short uppercase handle, e.g. LOCS), name (full name, nickname in quotes), label (caption speaker label), role (short line for the name tag, e.g. "21 · THE LEADER"), look, voice, rate.
- look: one precise sentence that will be repeated in every picture: age, build, face, skin tone, hair, and a distinctive wardrobe with colours (e.g. "a 21-year-old Black man with long thin dreadlocks past his shoulders, slim build, black hoodie"). Make each character instantly distinguishable.
- voice: choose from this list, matching age and gender: ${EPISODE_VOICES.map((v) => `${v.name} (${v.who}${v.styles ? ", can act" : ""})`).join("; ")}. Give different characters different voices. rate: "-10%" to "+10%".
- narrator (optional, for exposition): {"voice": one of the narrator voices above, "rate": "+0%"}. Use the speaker "N" for narrator lines.

SHOTS (the most important part)
- Every shot is filmed from a still picture, then animated for at most 5 seconds by a video model. Write for what that model does well.
- still: the first frame. Composition, place, time of day, light, and exactly who is where. For people in the shot, name them by reference image in order: "image 1's man (LOCS) on the left, laughing; image 2's boy (JOJO) beside him". List those keys in "cast", in the same order (max 3 per shot). Shots with nobody from the cast (establishing shots, objects, crowds, cars) have "cast": [].
- motion: ONE simple, natural action that keeps people in place: talking, reacting, gesturing, breathing, nodding, looking up, leaning in, walking slowly toward the camera, hands working on something, a slow camera push. NEVER: spinning, turning around, hugging or embracing, fighting, running across the frame, dancing in circles, a camera orbiting around people. Those break the faces.
- Mix wide, medium and close-up shots. Use close-ups for emotional lines. Use reaction shots and inserts (hands, objects) as coverage.
- seconds: 3 to 4.8.
- impacts: seconds into the shot where something hits hard (a gunshot, a door slam, a punch landing off-screen), for a shake and flash. Usually empty.
- sfx: a short sound-effect description for the shot when its world has a sound (rain on a tin roof, club bass through a wall, police siren chirp, crowd cheering). Many shots can leave it out.

LINES
- Most shots have no line. A line belongs to the shot where it starts: {"speaker": KEY or "N", "style": one of ${ACTING_STYLES.join(", ")} or omit, "text": "..."}.
- Keep every line under 18 words: punchy, specific, in the character's own voice.
- talking: true when the speaker is in that shot (in its cast) and their face is clearly visible talking (medium shot or close-up); their lips will be synced. Narrator lines are never talking.

BEATS AND LOOK
- beats: an ordered list. A beat is either {"name", "mood", "super"?, "shots": [...]} or a card {"name", "mood", "card": {"title", "sub", "seconds" 2.5-4, "style": "series" | "title" | "card" | "next"}}.
- The title card after the cold open has style "series", title = the series name, sub = "EPISODE ONE" or the episode title. A flashback opens with a card like {"title": "LOWER NINTH WARD", "sub": "2005", "style": "card"} and its beat uses mood "memory".
- super: a place or time over the first shot of a beat that moves to a new location: {"title": "BOURBON STREET", "sub": "THE FRENCH QUARTER"}.
- mood: one of ${MOODS.join(", ")} (it sets the colour grade and the music).
- look: one sentence of film look shared by every picture (lens, light, grain, palette).
- accent: a #RRGGBB colour for titles and caption labels that suits the show.
- music: the score in one sentence: genre, instruments, tempo, how it moves.

Return ONLY this JSON object:
{"series": "...", "title": "...", "logline": "...", "look": "...", "accent": "#E8C470", "narrator": {"voice": "...", "rate": "+0%"} or null, "cast": [...], "beats": [...], "music": "..."}`;

export async function writeEpisodePlan(o: { prompt: string; length: EpisodeLength; aspect: EpisodeAspect; maxShot: number }): Promise<EpisodePlan> {
  const lim = EPISODE_LENGTHS[o.length];
  const user =
    `Prompt: ${o.prompt.trim()}\n\n` +
    `Length: about ${lim.seconds} seconds, ${lim.minShots} to ${lim.maxShots} shots in all.\n` +
    `Frame: ${o.aspect === "9:16" ? "vertical 9:16 (phone): compose for a tall frame, people centred, faces in the upper half" : "widescreen 16:9: compose for a wide frame"}.`;
  const raw = await claudeJson<unknown>({ system: SYSTEM, user, maxTokens: 16_000, temperature: 0.8, model: DEFAULT_PREMIUM_MODEL, json: true });
  return normalizePlan(raw, o.length, o.maxShot);
}
