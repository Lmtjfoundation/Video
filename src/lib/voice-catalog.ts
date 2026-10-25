/**
 * The Voice Library (safe in the browser): Ghost Post's ready-made voices, each with the uses it suits, and voice
 * design starting points. Free voices run on Ghost Post's own server (Kokoro, English); designed voices are made
 * once on the engine from their description and then speak in 23 languages.
 */
export const VOICE_USES = ["Narration", "Audiobooks", "Ads", "Social", "Characters", "Conversational", "Kids", "Meditation", "News"] as const;
export type VoiceUse = (typeof VOICE_USES)[number];

export interface StockVoice {
  id: string;
  name: string;
  description: string;
  accent: "American" | "British";
  gender: "Female" | "Male";
  uses: VoiceUse[];
}

/** The free voices (Kokoro-82M, Apache 2.0). The ids match KOKORO_VOICES in free-voice.ts. */
export const STOCK_VOICES: StockVoice[] = [
  { id: "af_heart", name: "Heart", description: "Warm, natural and friendly", accent: "American", gender: "Female", uses: ["Narration", "Audiobooks", "Conversational", "Social"] },
  { id: "af_bella", name: "Bella", description: "Bright, young and upbeat", accent: "American", gender: "Female", uses: ["Ads", "Social", "Kids"] },
  { id: "af_nicole", name: "Nicole", description: "Soft and close, almost a whisper", accent: "American", gender: "Female", uses: ["Meditation", "Audiobooks", "Narration"] },
  { id: "af_sarah", name: "Sarah", description: "Clear and even", accent: "American", gender: "Female", uses: ["News", "Narration", "Conversational"] },
  { id: "am_michael", name: "Michael", description: "Friendly and easygoing", accent: "American", gender: "Male", uses: ["Conversational", "Narration", "Social"] },
  { id: "am_onyx", name: "Onyx", description: "Deep and steady", accent: "American", gender: "Male", uses: ["Narration", "Ads", "Audiobooks"] },
  { id: "am_fenrir", name: "Fenrir", description: "Strong and commanding", accent: "American", gender: "Male", uses: ["Ads", "Characters", "News"] },
  { id: "am_puck", name: "Puck", description: "Lively and playful", accent: "American", gender: "Male", uses: ["Characters", "Kids", "Social"] },
  { id: "bf_emma", name: "Emma", description: "Polished and warm", accent: "British", gender: "Female", uses: ["Narration", "Audiobooks", "News"] },
  { id: "bf_isabella", name: "Isabella", description: "Elegant and calm", accent: "British", gender: "Female", uses: ["Meditation", "Audiobooks", "Ads"] },
  { id: "bm_george", name: "George", description: "Rich, documentary-style", accent: "British", gender: "Male", uses: ["Narration", "News", "Audiobooks"] },
  { id: "bm_fable", name: "Fable", description: "A storyteller's voice", accent: "British", gender: "Male", uses: ["Audiobooks", "Kids", "Characters"] },
];

/** Starting points for Voice Design: a description the engine turns into a new voice. */
export const DESIGN_PRESETS: { name: string; description: string; uses: VoiceUse[] }[] = [
  { name: "Trailer narrator", description: "A deep, gravelly male voice with a slow, dramatic delivery, very close to the microphone, studio quality.", uses: ["Ads", "Narration"] },
  { name: "Bedtime storyteller", description: "A soft, warm female voice speaking slowly and gently, very clear studio audio.", uses: ["Kids", "Audiobooks"] },
  { name: "Upbeat ad read", description: "An energetic young female voice with a fast, bright and friendly delivery, studio quality.", uses: ["Ads", "Social"] },
  { name: "Podcast host", description: "A relaxed male voice in his thirties, conversational and at a natural pace, clear close-microphone audio.", uses: ["Conversational", "Social"] },
  { name: "News anchor", description: "A confident, neutral female voice with a measured pace and crisp diction, studio quality.", uses: ["News", "Narration"] },
  { name: "Documentary", description: "A calm, mature male voice with a British accent, a measured pace, rich and clear.", uses: ["Narration", "Audiobooks"] },
  { name: "Cartoon sidekick", description: "A playful, high-pitched and very expressive voice with a quick pace, very clear audio.", uses: ["Characters", "Kids"] },
  { name: "Quiet villain", description: "A low, menacing male voice, slow and quiet, slightly raspy, close to the microphone.", uses: ["Characters"] },
  { name: "Meditation guide", description: "A very calm, soothing female voice, slow and soft, clear studio audio.", uses: ["Meditation"] },
  { name: "Southern storyteller", description: "A warm older man with a slight Southern drawl, unhurried and friendly, close to the microphone.", uses: ["Audiobooks", "Narration", "Characters"] },
];

/** What a designed voice reads for its sample (about 15 seconds of varied, ordinary speech). */
export const DESIGN_SAMPLE_TEXT =
  "Hello, and welcome. Today I'm going to tell you a story about a small town, a long summer, and a secret nobody was supposed to find. Are you ready? Then let's begin.";

/**
 * How a line is voiced: a free voice on Ghost Post's server (English, `speed` 0.7 to 1.3), or the engine in one of
 * its 23 languages, in its own voice or one of My Voices (cloned or designed).
 */
export type VoiceChoice = { kind: "free"; id: string; speed?: number } | { kind: "engine"; language: string; voiceId?: string };
