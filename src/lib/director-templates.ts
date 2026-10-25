/**
 * Quick starts for the Director (safe in the browser): each fills the first message with a proven structure for that
 * kind of video, ready for the person to fill in, and picks a fitting length and platform.
 */
export interface DirectorTemplate {
  id: string;
  name: string;
  length: "s30" | "s60" | "s90" | "m3";
  platform: "tiktok" | "youtube" | "instagram";
  brief: string;
}

export const DIRECTOR_TEMPLATES: DirectorTemplate[] = [
  { id: "short-film", name: "Short film", length: "m3", platform: "youtube", brief: "A short film. Story: [who wants what, and what stands in the way]. Open on a striking image, build to one turning point, end on an image that stays with you. Mood: [tense / tender / funny]." },
  { id: "music-video", name: "Music video", length: "s90", platform: "youtube", brief: "A music video for [song or artist, genre, tempo]. Visual story: [a simple idea that repeats and grows]. Cut on the beat, mix performance shots with story shots, one bold color palette throughout." },
  { id: "ugc-ad", name: "UGC ad", length: "s30", platform: "tiktok", brief: "A UGC-style ad, filmed like a real customer on their phone. Product: [name and what it does]. Hook in the first 2 seconds, the problem they had, the product in use, the result, and a clear call to action: [offer]." },
  { id: "product-ad", name: "Product ad", length: "s30", platform: "instagram", brief: "A premium product ad. Product: [name, what makes it special]. Macro close-ups of the details, the product in its best setting, one line of benefit per shot, end on the product and [tagline]." },
  { id: "trailer", name: "Film trailer", length: "s60", platform: "youtube", brief: "A trailer for [title, genre]. Calm opening that sets the world, the inciting moment, rising tension with quicker cuts, a beat of silence, the biggest moment, then the title card and [release line]." },
  { id: "social", name: "Social content", length: "s30", platform: "tiktok", brief: "A scroll-stopping social video about [topic]. A bold claim or question in the first second, three fast points with a visual for each, and an ending that makes people comment: [question]." },
  { id: "branding", name: "Brand film", length: "s60", platform: "instagram", brief: "A brand film for [brand]. What it stands for: [values]. Real moments of the people it serves, the brand's world in its colors, and a closing line: [promise]." },
  { id: "explainer", name: "Explainer", length: "s90", platform: "youtube", brief: "An explainer about [topic] for [audience]. Start with why it matters, explain it in three simple steps with a clear visual metaphor for each, and end with what to do next." },
  { id: "micro-drama", name: "Micro drama", length: "s90", platform: "tiktok", brief: "A micro drama episode. Characters: [names and what they want]. Start in the middle of a conflict, a twist at the midpoint, and end on a cliffhanger: [the reveal]." },
  { id: "podcast", name: "Podcast clip", length: "s60", platform: "youtube", brief: "A video for a podcast moment about [topic]. The host's strongest line as the hook, pictures that show what's being said, captions on every line, and an ending that sends people to the full episode." },
];
