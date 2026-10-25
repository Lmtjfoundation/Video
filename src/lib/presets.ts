import type { AssetKind } from "./library-tags";

/**
 * Ready-made starting points for the AI generators: pick one and the prompt and settings fill in, then change
 * anything. Footage presets are camera moves and looks that Wan 2.2 follows from the prompt alone.
 */
export interface Preset {
  id: string;
  kind: AssetKind;
  title: string;
  blurb: string;
  prompt: string;
  seconds?: number;
  bpm?: number;
  genres?: string[];
  moods?: string[];
  category?: string;
  aspect?: string;
  /** Footage: the subject goes where {subject} is. */
  needsSubject?: boolean;
}

export const PRESETS: Preset[] = [
  // Music
  { id: "trailer-epic", kind: "music", title: "Epic trailer", blurb: "Huge drums, strings, a final hit", prompt: "Epic cinematic trailer music, pounding taiko drums, soaring strings and brass, slow build to a massive final hit", seconds: 90, bpm: 100, genres: ["Cinematic", "Orchestral"], moods: ["Epic", "Dramatic"] },
  { id: "true-crime", kind: "music", title: "True-crime tension", blurb: "Dark pulse for drama and crime", prompt: "Dark tense underscore for a crime drama, low pulsing synth bass, ticking percussion, eerie piano notes, slow build of suspense", seconds: 120, bpm: 80, genres: ["Cinematic", "Electronic"], moods: ["Tense", "Dark", "Suspense"] },
  { id: "lofi", kind: "music", title: "Lo-fi study beat", blurb: "Warm, dusty, relaxed", prompt: "Lo-fi hip hop beat, warm Rhodes chords, dusty vinyl crackle, soft boom-bap drums, mellow bass, relaxed and cozy", seconds: 120, bpm: 82, genres: ["Lo-fi", "Hip hop"], moods: ["Chill", "Nostalgic"] },
  { id: "trap", kind: "music", title: "Hard trap beat", blurb: "808s and hi-hat rolls", prompt: "Hard trap instrumental, booming 808 bass, fast hi-hat rolls, dark bell melody, punchy snare, street energy", seconds: 120, bpm: 140, genres: ["Trap", "Hip hop"], moods: ["Confident", "Dark"] },
  { id: "rnb-slow", kind: "music", title: "Slow R&B", blurb: "Smooth and romantic", prompt: "Smooth slow R&B instrumental, silky electric piano, deep bass, soft finger snaps, lush pads, late-night romantic mood", seconds: 150, bpm: 72, genres: ["R&B", "Soul"], moods: ["Romantic", "Sexy"] },
  { id: "corporate", kind: "music", title: "Uplifting corporate", blurb: "Bright and positive for brands", prompt: "Uplifting corporate background music, bright piano, plucked guitar, light claps and steady kick, positive and motivating", seconds: 90, bpm: 115, genres: ["Corporate", "Pop"], moods: ["Uplifting", "Inspiring"] },
  { id: "wedding-piano", kind: "music", title: "Wedding piano", blurb: "Tender solo piano", prompt: "Tender solo piano ballad, gentle flowing melody, soft sustain, emotional and hopeful, for a wedding film", seconds: 120, bpm: 68, genres: ["Piano", "Classical"], moods: ["Romantic", "Hopeful"] },
  { id: "afrobeats", kind: "music", title: "Afrobeats groove", blurb: "Sunny dance rhythm", prompt: "Afrobeats instrumental, bouncy log drums, shakers, warm guitar riff, sunny synth lead, danceable groove", seconds: 120, bpm: 105, genres: ["Afrobeats"], moods: ["Happy", "Energetic"] },
  { id: "gospel", kind: "music", title: "Gospel uplift", blurb: "Organ, choir, hand claps", prompt: "Uplifting gospel instrumental, Hammond organ, choir oohs, hand claps, grand piano, joyful and powerful build", seconds: 120, bpm: 92, genres: ["Gospel", "Soul"], moods: ["Uplifting", "Hopeful"] },
  { id: "synthwave", kind: "music", title: "Synthwave night drive", blurb: "Retro 80s neon", prompt: "Synthwave track, retro analog synth arpeggios, gated reverb drums, warm bass, neon night drive feeling", seconds: 120, bpm: 110, genres: ["Synthwave", "Electronic"], moods: ["Nostalgic", "Dreamy"] },
  { id: "vlog-pop", kind: "music", title: "Happy vlog pop", blurb: "Light and catchy", prompt: "Happy upbeat vlog music, ukulele, whistling hook, hand claps, bouncy bass, light and playful", seconds: 60, bpm: 120, genres: ["Pop", "Acoustic"], moods: ["Happy", "Playful"] },
  { id: "documentary", kind: "music", title: "Documentary ambient", blurb: "Thoughtful, spacious", prompt: "Thoughtful ambient documentary score, soft evolving pads, sparse piano, gentle cello, spacious and reflective", seconds: 150, bpm: 70, genres: ["Ambient", "Cinematic"], moods: ["Peaceful", "Serious"] },

  // Sound effects
  { id: "rain-night", kind: "sfx", title: "City rain at night", blurb: "Steady rain, gutters", prompt: "Heavy rain falling on a city street at night, steady downpour, water running in gutters", seconds: 20, category: "Weather" },
  { id: "sirens", kind: "sfx", title: "Distant sirens", blurb: "Police wailing through the city", prompt: "Police sirens wailing in the distance, slowly approaching through city streets", seconds: 12, category: "City" },
  { id: "door-slam", kind: "sfx", title: "Door slam", blurb: "Heavy wooden door", prompt: "Heavy wooden door slamming shut, deep resonant thud, faint frame rattle", seconds: 2, category: "Doors" },
  { id: "whoosh", kind: "sfx", title: "Fast whoosh", blurb: "Transition swish", prompt: "Fast airy whoosh passing left to right, clean transition swish", seconds: 1.5, category: "Whooshes" },
  { id: "boom", kind: "sfx", title: "Cinematic boom", blurb: "Deep impact for titles", prompt: "Deep cinematic boom impact with a long reverb tail", seconds: 5, category: "Impacts" },
  { id: "riser", kind: "sfx", title: "Tension riser", blurb: "Builds to a hit", prompt: "Tense cinematic riser, rising whoosh building up to a hit", seconds: 6, category: "Risers" },
  { id: "phone-buzz", kind: "sfx", title: "Phone vibrating", blurb: "On a wooden table", prompt: "Cell phone vibrating on a wooden table, close-mic buzzing", seconds: 4, category: "Phones" },
  { id: "footsteps", kind: "sfx", title: "Footsteps", blurb: "Hard floor, walking", prompt: "Footsteps of a man walking on a hard wooden floor, steady pace, small room", seconds: 6, category: "Footsteps" },
  { id: "crowd", kind: "sfx", title: "Crowd cheering", blurb: "Stadium roar", prompt: "Large stadium crowd cheering and applauding, roaring excitement", seconds: 10, category: "Crowds" },
  { id: "ui-click", kind: "sfx", title: "UI click", blurb: "Soft app tap", prompt: "Soft short digital user interface click, clean and subtle", seconds: 0.5, category: "UI" },
  { id: "forest", kind: "sfx", title: "Forest morning", blurb: "Birds and breeze", prompt: "Forest morning ambience, birds singing, gentle breeze through leaves, distant stream", seconds: 25, category: "Nature" },
  { id: "car-pass", kind: "sfx", title: "Car passing", blurb: "Wet road, doppler", prompt: "Car passing by fast on a wet road, engine and tire hiss with doppler effect", seconds: 5, category: "Vehicles" },

  // Footage: camera moves and looks
  { id: "drone", kind: "footage", title: "Drone flyover", blurb: "Smooth aerial glide", prompt: "Smooth aerial drone flyover of {subject}, golden hour light, slow forward glide, cinematic", aspect: "16:9", category: "Aerial", needsSubject: true },
  { id: "dolly-in", kind: "footage", title: "Slow dolly-in", blurb: "Push in on the subject", prompt: "Slow cinematic dolly-in toward {subject}, shallow depth of field, soft film light", category: "People", needsSubject: true },
  { id: "orbit", kind: "footage", title: "Orbit shot", blurb: "Camera circles the subject", prompt: "Camera slowly orbits around {subject}, smooth 180 degree arc, dramatic lighting", category: "Lifestyle", needsSubject: true },
  { id: "hyperlapse", kind: "footage", title: "Hyperlapse", blurb: "Time racing by", prompt: "Hyperlapse moving through {subject}, time racing by, light trails, fast clouds", category: "City", needsSubject: true },
  { id: "slowmo", kind: "footage", title: "Slow motion", blurb: "High-speed detail", prompt: "Extreme slow motion of {subject}, high-speed camera, every detail suspended, crisp lighting", category: "Slow motion", needsSubject: true },
  { id: "dashcam", kind: "footage", title: "Dash cam", blurb: "Through the windshield", prompt: "Dash cam view through a car windshield driving through {subject}, slight wide-angle distortion, real-time motion", aspect: "16:9", category: "Cars", needsSubject: true },
  { id: "product", kind: "footage", title: "Product turntable", blurb: "Clean studio spin", prompt: "{subject} slowly rotating on a turntable in a clean studio, soft gradient background, glossy reflections", aspect: "1:1", category: "Business", needsSubject: true },
  { id: "handheld", kind: "footage", title: "Handheld doc", blurb: "Real, close, alive", prompt: "Handheld documentary shot following {subject}, natural light, slight camera shake, intimate and real", category: "People", needsSubject: true },
  { id: "neon-night", kind: "footage", title: "Neon night", blurb: "Rain and city lights", prompt: "{subject} at night in the rain, neon signs reflecting on wet pavement, moody cinematic color", aspect: "9:16", category: "Night", needsSubject: true },
  { id: "bg-loop", kind: "footage", title: "Abstract background", blurb: "Slow flowing loop", prompt: "Slow flowing abstract background of {subject}, soft gradients, gentle motion, seamless and calm", category: "Backgrounds", needsSubject: true },
];

export const presetsFor = (kind: AssetKind) => PRESETS.filter((p) => p.kind === kind);
export const fillSubject = (p: Preset, subject: string) => p.prompt.replace("{subject}", subject.trim() || "the scene");
