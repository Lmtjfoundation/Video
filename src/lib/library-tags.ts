/**
 * The Library's tags: what music, sound effects and footage are filed under, so people can browse by genre, mood,
 * the kind of video it's for, instruments, tempo and length. Shared by the browser and the server.
 */
export type AssetKind = "music" | "sfx" | "footage";
export const ASSET_KINDS: AssetKind[] = ["music", "sfx", "footage"];
export const KIND_LABEL: Record<AssetKind, string> = { music: "Music", sfx: "Sound effects", footage: "Footage" };

export const GENRES = [
  "Cinematic", "Hip hop", "Trap", "R&B", "Soul", "Pop", "Rock", "Indie", "Electronic", "House", "Lo-fi", "Ambient",
  "Jazz", "Blues", "Classical", "Orchestral", "Piano", "Acoustic", "Folk", "Country", "Funk", "Gospel", "Latin",
  "Afrobeats", "Reggae", "Drill", "Synthwave", "Corporate", "Children", "World",
] as const;
export const MOODS = [
  "Uplifting", "Happy", "Hopeful", "Inspiring", "Epic", "Energetic", "Confident", "Playful", "Romantic", "Peaceful",
  "Dreamy", "Nostalgic", "Sad", "Melancholy", "Dramatic", "Tense", "Suspense", "Dark", "Mysterious", "Angry",
  "Sexy", "Chill", "Quirky", "Serious",
] as const;
/** What the video is: Artlist calls these themes. */
export const THEMES = [
  "Vlog", "Commercial", "Trailer", "Documentary", "Drama", "Crime", "Action", "Sports", "Travel", "Fashion", "Food",
  "Tech", "Business", "Wedding", "Family", "Nature", "Urban", "Gaming", "Holiday", "Social media", "Podcast", "Tutorial",
] as const;
export const INSTRUMENTS = [
  "Piano", "Acoustic guitar", "Electric guitar", "Bass", "808", "Drums", "Strings", "Brass", "Synth", "Pads", "Choir",
  "Vocals", "Whistle", "Organ", "Saxophone", "Percussion", "Bells", "Harp", "Violin", "Cello",
] as const;
export const SFX_CATEGORIES = [
  "Ambience", "Weather", "Nature", "Animals", "City", "Vehicles", "Doors", "Footsteps", "Impacts", "Whooshes",
  "Transitions", "Risers", "Household", "Office", "Technology", "Phones", "Weapons", "Explosions", "Crowds", "Human",
  "Water", "Fire", "Sci-fi", "Cartoon", "UI", "Foley", "Sports", "Music stingers",
] as const;
export const FOOTAGE_CATEGORIES = [
  "People", "Lifestyle", "City", "Nature", "Aerial", "Business", "Technology", "Food", "Travel", "Sports",
  "Abstract", "Night", "Weather", "Home", "Cars", "Animals", "Backgrounds", "Slow motion",
] as const;

export const TEMPOS = [
  { id: "slow", label: "Slow (under 90)", min: 0, max: 89 },
  { id: "medium", label: "Medium (90–119)", min: 90, max: 119 },
  { id: "fast", label: "Fast (120–149)", min: 120, max: 149 },
  { id: "very-fast", label: "Very fast (150+)", min: 150, max: 999 },
] as const;
export const LENGTHS = [
  { id: "short", label: "Under 30 s", min: 0, max: 29.99 },
  { id: "mid", label: "30 s – 2 min", min: 30, max: 119.99 },
  { id: "long", label: "2 min +", min: 120, max: 1e9 },
] as const;
export const SORTS = [
  { id: "new", label: "Newest" },
  { id: "popular", label: "Most downloaded" },
  { id: "short", label: "Shortest" },
  { id: "long", label: "Longest" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];

/** Keeps only tags that are in the list (any case), in the list's spelling. */
export function pickTags(list: readonly string[], wanted: unknown, max = 4): string[] {
  if (!Array.isArray(wanted)) return [];
  const byLower = new Map(list.map((t) => [t.toLowerCase(), t]));
  const out: string[] = [];
  for (const w of wanted) {
    const t = byLower.get(String(w).trim().toLowerCase());
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Tags found in free text (a prompt), for filing when no writer is available. */
export function tagsInText(list: readonly string[], text: string, max = 3): string[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9&+ -]/g, " ")} `;
  return list.filter((tag) => t.includes(` ${tag.toLowerCase()} `) || t.includes(` ${tag.toLowerCase()}s `)).slice(0, max);
}

export function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec === 60 ? 59 : sec).padStart(2, "0")}`;
}
