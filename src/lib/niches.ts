/**
 * Niche revenue data (sourced). YouTube long-form RPM = median and P25–P75 from AIR Media-Tech's
 * 300-channel study of channels' own YouTube Studio data (May 2025 – May 2026). `dir` marks niches
 * with fewer than 10 channels (directional only). Update this table as new data is published.
 */
export interface NicheRow {
  id: string;
  name: string;
  rpm: number;
  lo: number;
  hi: number;
  dir?: string;
  fit: string;
  formats: string;
  shorts?: string;
  /** TikTok Creator Rewards niche multiplier vs the market baseline */
  tt: number;
  note?: string;
}

export const NICHES: NicheRow[] = [
  { id: "edu", name: "Education & Science", rpm: 10.22, lo: 2.31, hi: 19.5, fit: "High", formats: "History mysteries, how-it-works explainers, science stories", shorts: "≈$0.54–$1.44 (modeled, not measured)", tt: 1.0 },
  { id: "transport", name: "Transport (cars, aviation, ships)", rpm: 5.69, lo: 3.17, hi: 9.81, dir: "7 channels", fit: "High", formats: "Disaster investigations, engineering stories, how it was built", tt: 1.0 },
  { id: "lifestyle", name: "Lifestyle", rpm: 2.98, lo: 1.77, hi: 5.24, fit: "Medium", formats: "Life systems, routines, minimalism stories", shorts: "$0.16–$0.20", tt: 1.0 },
  { id: "news", name: "News & Politics", rpm: 2.6, lo: 1.79, hi: 3.62, dir: "3 channels", fit: "High — strict accuracy needed", formats: "Explainer recaps, timelines", tt: 1.0 },
  { id: "ent", name: "Entertainment", rpm: 2.43, lo: 0.88, hi: 5.02, fit: "High", formats: "Labeled fiction, mysteries, ranked lists", tt: 0.85 },
  { id: "craft", name: "Crafting & Handmade", rpm: 2.39, lo: 1.0, hi: 3.9, fit: "Medium — hands only", formats: "Process and restoration stories", shorts: "$0.11", tt: 1.0 },
  { id: "tech", name: "Gadgets & Tech", rpm: 2.33, lo: 0.7, hi: 3.71, fit: "High", formats: "AI tool walkthroughs, tech history, comparisons", tt: 1.18 },
  { id: "music", name: "Music", rpm: 2.28, lo: 1.35, hi: 4.16, fit: "High", formats: "Song origin stories, theory explainers", shorts: "$0.97–$1.48", tt: 1.0 },
  { id: "food", name: "Food & Cooking", rpm: 2.25, lo: 1.5, hi: 3.11, dir: "6 channels", fit: "High — hands only", formats: "Food history, recipe stories", tt: 0.95 },
  { id: "gaming", name: "Gaming", rpm: 2.05, lo: 0.7, hi: 3.62, fit: "High", formats: "Lore stories, game-history documentaries", tt: 0.9 },
  { id: "finance", name: "Business & Finance", rpm: 2.01, lo: 0.73, hi: 5.17, dir: "3 channels", fit: "High", formats: "Company rise-and-fall stories, money explainers, scams exposed", tt: 1.3, note: "Only 3 channels in this study. Other published sources put finance advertiser prices (CPM) among the highest of any niche." },
  { id: "health", name: "Health & Sport", rpm: 1.23, lo: 0.72, hi: 1.53, fit: "Medium", formats: "Habit science, athlete stories", tt: 1.0 },
  { id: "kids", name: "Kids & Teens", rpm: 0.33, lo: 0.16, hi: 0.88, fit: "Not recommended", formats: "Made-for-Kids rules limit ads and comments", tt: 1.0 },
];

/** TikTok Creator Rewards, US benchmark per 1,000 qualified views; only videos over 1 minute earn. */
export const TT_US_RPM = 0.85;

export const NICHE_SOURCES: [string, string][] = [
  ["AIR Media-Tech — YouTube RPM by niche 2026 (300 channels)", "https://air.io/en/air-data-findings/which-youtube-niche-makes-the-most-money-in-2026-ranked-by-real-rpm-and-cpm"],
  ["AIR Media-Tech — YouTube Shorts RPM by niche (274 channels)", "https://air.io/en/air-data-findings/what-is-youtube-shorts-rpm-in-your-niche-in-2026"],
  ["OutlierKit — published RPM/CPM benchmarks compared, with caveats", "https://outlierkit.com/resources/youtube-rpm-benchmarks/"],
  ["Elev8or — TikTok Creator Rewards RPM 2026", "https://www.elev8or.io/blog/tiktok-creator-rewards-rpm-2026"],
];

export const nicheTable = () =>
  NICHES.map(
    (n) =>
      `- ${n.name}: median RPM $${n.rpm} (P25–P75 $${n.lo}–$${n.hi})${n.dir ? ` [directional, ${n.dir}]` : ""}; faceless fit ${n.fit}; Shorts RPM ${n.shorts ?? "not published"}; TikTok niche multiplier ${n.tt}x`,
  ).join("\n");

export const STORY_FORMATS = {
  short: { label: "YouTube Short · 45–58 s", words: "120–150 words", scenes: "6–9", platform: "youtube" as const, note: "Loop the last line into the first." },
  tiktok: { label: "TikTok · 61–90 s", words: "170–230 words", scenes: "8–12", platform: "tiktok" as const, note: "Must run over 1 minute to earn from Creator Rewards." },
  long: { label: "YouTube long-form · 8–10 min", words: "1,200–1,500 words", scenes: "14–20", platform: "youtube" as const, note: "Re-hook every 30–60 seconds; mid-roll friendly beats." },
  episode: { label: "Series episode · about 3 min (Reels, TikTok, Shorts)", words: "430–480 words", scenes: "8–12", platform: "instagram" as const, note: "Open cold on the most dramatic moment, keep one story thread per episode, and end on a cliffhanger that sets up the next one." },
};

export const STORY_TYPES = {
  true: "True story — documented events only",
  funny: "Funny history — real events that were genuinely absurd",
  explainer: "Explainer story — how or why something works",
  fiction: "Fiction — clearly labeled as made up",
};

/** Quality rules added to every niche and story prompt. */
export const QUALITY_BAR = `QUALITY BAR (non-negotiable):
- Every idea is a SPECIFIC, real, documented event, person or mechanism with its date or place — never a vague theme ("the power of habits") or a generic listicle.
- No slop and no fluff: no filler intros, no "you won't believe", no fake suspense, no motivational padding, no AI clichés. Every sentence carries a fact, a stake or a payoff.
- Humor must be HISTORICALLY funny: the comedy comes from real events that were genuinely absurd (e.g. the 1932 Emu War), told straight and deadpan. Never invented jokes, fake quotes, memes or mocking real victims.
- Hooks state the most surprising TRUE fact in the first sentence. If a detail is disputed, say "reports differ" instead of picking the juicier version.
- The niche, the story and the audience must obviously fit together, and the choice should favor what earns the most.`;
