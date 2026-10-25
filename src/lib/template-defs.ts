/** The video templates and their fields (safe in the browser). See video-templates.ts. */
export interface TemplateField {
  key: string;
  label: string;
  example: string;
  max: number;
  long?: boolean;
}
export interface TemplateDef {
  id: "title" | "lower-third" | "end-screen" | "quote" | "countdown" | "promo" | "episode";
  name: string;
  blurb: string;
  seconds: number;
  /** Usually laid over footage, so it starts see-through. */
  overlay?: boolean;
  fields: TemplateField[];
}

export type TemplateBackground = { type: "color"; color: string } | { type: "media"; mediaId: string } | { type: "transparent" };
export interface TemplateInput {
  template: string;
  values: Record<string, string>;
  aspect: string;
  accent?: string;
  textColor?: string;
  background?: TemplateBackground;
}

export const TEMPLATE_DEFS: TemplateDef[] = [
  { id: "title", name: "Title", blurb: "A big title that rises in, with a subtitle", seconds: 4, fields: [{ key: "title", label: "Title", example: "The Settlement", max: 60 }, { key: "subtitle", label: "Subtitle", example: "A new series", max: 80 }] },
  { id: "lower-third", name: "Lower third", blurb: "Name and role, sliding in at the bottom", seconds: 5, overlay: true, fields: [{ key: "name", label: "Name", example: "Marcus Grant", max: 40 }, { key: "role", label: "Role", example: "AC technician, Houston", max: 50 }] },
  { id: "end-screen", name: "End screen", blurb: "Follow-for-more with your handle", seconds: 5, fields: [{ key: "headline", label: "Headline", example: "Episode 2 drops Friday", max: 50 }, { key: "handle", label: "Handle", example: "@thesettlement", max: 30 }, { key: "cta", label: "Call to action", example: "Follow so you don't miss it", max: 70 }] },
  { id: "quote", name: "Quote card", blurb: "A quote with its author", seconds: 6, fields: [{ key: "quote", label: "Quote", example: "Every marriage has a settlement. Most people just never see the bill.", max: 220, long: true }, { key: "author", label: "Author", example: "The Settlement", max: 40 }] },
  { id: "countdown", name: "Countdown", blurb: "3, 2, 1 with a progress bar", seconds: 3, fields: [] },
  { id: "promo", name: "Promo", blurb: "Headline, offer and a call to action", seconds: 5, fields: [{ key: "headline", label: "Headline", example: "Midnight Cold Brew", max: 50 }, { key: "offer", label: "Offer", example: "30% OFF", max: 16 }, { key: "cta", label: "Call to action", example: "Link in bio · today only", max: 60 }] },
  { id: "episode", name: "Episode card", blurb: "Series name, episode and a tagline", seconds: 4, fields: [{ key: "series", label: "Series", example: "The Settlement", max: 40 }, { key: "episode", label: "Episode", example: "Episode Two", max: 30 }, { key: "tagline", label: "Tagline", example: "One contact. One letter.", max: 70 }] },
];
