/** Flow steps, their prices and the ready-made flows (safe in the browser). See flows.ts. */
import { CREDIT_COST } from "./plans";

export const FLOW_STEP_TYPES = ["prompt", "image", "footage", "music", "sfx", "voiceover", "finish"] as const;
export type FlowStepType = (typeof FLOW_STEP_TYPES)[number];

export interface FlowStep {
  type: FlowStepType;
  /** Uses {idea} and {text}; blank uses the step's default. */
  prompt?: string;
  seconds?: number;
  aspect?: "9:16" | "16:9" | "1:1";
  language?: string;
  voiceId?: string;
  /** Auto-prompt: which generator the prompt is written for. */
  kind?: "music" | "sfx" | "footage" | "image";
}

export interface Flow {
  id: string;
  name: string;
  steps: FlowStep[];
  createdAt: string;
}

/** What a run costs, step by step (the same prices as running each tool by hand). */
export function flowCredits(f: Pick<Flow, "steps">, ideaLength = 200) {
  return f.steps.reduce((sum, s) => {
    switch (s.type) {
      case "prompt":
        return sum + CREDIT_COST.autoPrompt;
      case "image":
        return sum + CREDIT_COST.aiImage;
      case "footage":
        return sum + CREDIT_COST.ownSecond * Math.min(5, Math.max(1, s.seconds ?? 5));
      case "music":
        return sum + CREDIT_COST.aiMusic;
      case "sfx":
        return sum + CREDIT_COST.aiSfx;
      case "voiceover":
        return sum + CREDIT_COST.speech * Math.max(1, Math.ceil(Math.max(ideaLength, s.prompt?.length ?? 0) / 1000));
      default:
        return sum;
    }
  }, 0);
}

export const STEP_LABEL: Record<FlowStepType, { title: string; hint: string }> = {
  prompt: { title: "Auto-prompt", hint: "Writes a detailed prompt from the idea: use it later as {text}" },
  image: { title: "Picture", hint: "A still from the prompt; the next footage step starts from it" },
  footage: { title: "Footage", hint: "A 1–5 second clip (from the last picture, if there is one)" },
  music: { title: "Music", hint: "A track for the background" },
  sfx: { title: "Sound effect", hint: "Played at the start" },
  voiceover: { title: "Voiceover", hint: "Read in any of 23 languages or one of My Voices" },
  finish: { title: "Finish", hint: "Cuts it all into one video with the sound mixed" },
};

/** Ready-made flows to start from (copied into your flows when you edit them). */
export const FLOW_TEMPLATES: Omit<Flow, "id" | "createdAt">[] = [
  {
    name: "Product ad",
    steps: [
      { type: "prompt", kind: "image", prompt: "A premium product photo for: {idea}" },
      { type: "image", aspect: "9:16" },
      { type: "footage", prompt: "{idea}, slow cinematic push in, studio lighting, product glistening", seconds: 5 },
      { type: "music", prompt: "Modern upbeat commercial music, confident and bright, for an ad about {idea}", seconds: 30 },
      { type: "voiceover", prompt: "{idea}", language: "en" },
      { type: "finish" },
    ],
  },
  {
    name: "Movie trailer teaser",
    steps: [
      { type: "image", prompt: "A dramatic cinematic film still: {idea}. Moody lighting, anamorphic look", aspect: "16:9" },
      { type: "footage", prompt: "{idea}, slow dramatic dolly in, cinematic, film grain", seconds: 5 },
      { type: "image", prompt: "A tense close-up film still from the same story: {idea}", aspect: "16:9" },
      { type: "footage", prompt: "{idea}, handheld tension, shallow depth of field", seconds: 5 },
      { type: "music", prompt: "Epic dark trailer music, pounding drums, rising strings, a final massive hit", seconds: 30 },
      { type: "sfx", prompt: "Deep cinematic boom impact with a long tail", seconds: 5 },
      { type: "finish" },
    ],
  },
  {
    name: "Talking-head explainer",
    steps: [
      { type: "image", prompt: "A friendly presenter facing the camera in a bright modern studio, talking about {idea}", aspect: "9:16" },
      { type: "footage", prompt: "The presenter talks to the camera with natural gestures", seconds: 5 },
      { type: "music", prompt: "Light, positive background music for an explainer, soft and unobtrusive", seconds: 60 },
      { type: "voiceover", prompt: "{idea}", language: "en" },
      { type: "finish" },
    ],
  },
  {
    name: "Mood reel (no words)",
    steps: [
      { type: "prompt", kind: "footage", prompt: "{idea}" },
      { type: "footage", prompt: "{text}", seconds: 5, aspect: "9:16" },
      { type: "footage", prompt: "{idea}, a different angle, slow motion", seconds: 5 },
      { type: "music", prompt: "Atmospheric music that fits: {idea}", seconds: 30 },
      { type: "finish" },
    ],
  },
];
