/**
 * Story to Video templates (safe in the browser): each is a brief for the writer, a fitting art style and length.
 * The looks are the exact strings from CHARACTER_LOOK_GROUPS.
 */
export interface StoryTemplate {
  id: string;
  name: string;
  blurb: string;
  guide: string;
  look: string;
  length: "s30" | "s60" | "s90" | "m3";
  /** Written for children: gentle, clear, nothing frightening. */
  kids?: boolean;
  /** Narration in two languages (the output language and a second one). */
  bilingual?: "story" | "dialogue";
}

const PIXAR = "Pixar-style 3D animation, soft cinematic lighting";
const WATERCOLOR = "Storybook watercolor illustration";
const CINEMA = "Cinematic realism, anamorphic 35mm film, shallow depth of field, warm practical light";

export const STORY_TEMPLATES: StoryTemplate[] = [
  { id: "general", name: "General story", blurb: "Any story, told well.", guide: "Tell it as a complete short story with a clear beginning, a turning point and a satisfying ending. Open with a hook in the first line.", look: CINEMA, length: "s90" },
  { id: "fitness", name: "Fitness short", blurb: "A workout or tip people can follow.", guide: "A motivating fitness short: a one-line promise, 3 to 5 moves or tips each with a clear cue and the common mistake to avoid, and an encouraging finish. Energetic and precise.", look: "High-end commercial photography, studio lighting, crisp 4K detail", length: "s60" },
  { id: "history-kids", name: "History for kids", blurb: "A moment from history children remember.", guide: "Explain the history for children aged 6 to 10: a curious question to start, the people and what happened in simple words, one surprising fact, and what it means today. Accurate, gentle and fun.", look: PIXAR, length: "s90", kids: true },
  { id: "science-kids", name: "Science for kids", blurb: "How the world works, made simple.", guide: "Explain the science for children aged 6 to 10: start with something they've noticed, explain it with an everyday comparison, show one safe at-home way to see it, and end with a wow fact. Accurate and simple.", look: PIXAR, length: "s90", kids: true },
  { id: "bedtime", name: "Bedtime story", blurb: "A calm story to fall asleep to.", guide: "A soothing bedtime story: soft, slow sentences, a cozy setting, a small gentle adventure with no danger, and an ending where everyone is safe and sleepy. Calm and warm.", look: WATERCOLOR, length: "m3", kids: true },
  { id: "bilingual-story", name: "Bilingual story", blurb: "Learn a language through a story.", guide: "A short story for language learners. Each scene's narration is one simple sentence in the main language, then the same sentence in the second language. Everyday words, short sentences.", look: WATERCOLOR, length: "s90", bilingual: "story" },
  { id: "bilingual-dialogue", name: "Bilingual dialogue", blurb: "A real conversation in two languages.", guide: "A short everyday conversation between two people (ordering food, asking for directions, meeting someone). Each scene is one line of dialogue in the main language, then the same line in the second language.", look: PIXAR, length: "s90", bilingual: "dialogue" },
  { id: "horror", name: "Horror", blurb: "A scary story with a twist.", guide: "A horror short: an ordinary place, a small wrong detail, dread that builds scene by scene, and a final twist in the last line. Never gory; fear comes from what isn't shown.", look: "Gritty urban night realism, sodium streetlights, wet asphalt, film grain", length: "s90" },
  { id: "healing", name: "Healing", blurb: "Comfort, calm and hope.", guide: "A healing, uplifting piece: speak gently to someone going through a hard time, with calming images of nature and light, one small practical comfort, and a hopeful close.", look: WATERCOLOR, length: "s60" },
  { id: "christian", name: "Bible story", blurb: "A story from the Bible, told faithfully.", guide: "Retell the Bible story faithfully to scripture, in clear and reverent language, with its meaning for today at the end. Name the book and chapter it comes from.", look: CINEMA, length: "s90" },
  { id: "islamic", name: "Islamic story", blurb: "A story of the prophets or a lesson from the Quran.", guide: "Retell the Islamic story or lesson faithfully and respectfully, following mainstream sources. Do not show the face of any prophet or companion: describe scenes, places and nature instead. End with its lesson.", look: WATERCOLOR, length: "s90" },
  { id: "buddhist", name: "Buddhist story", blurb: "A teaching tale and its wisdom.", guide: "Retell the Buddhist teaching story (a Jataka tale or a parable) calmly and faithfully, with the teaching it carries stated simply at the end.", look: WATERCOLOR, length: "s90" },
];

export const storyTemplate = (id: string) => STORY_TEMPLATES.find((t) => t.id === id) ?? STORY_TEMPLATES[0];

/** Where the story comes from. */
export type StorySourceKind = "idea" | "script" | "media" | "link" | "file";
