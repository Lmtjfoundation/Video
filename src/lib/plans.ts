/**
 * Subscription plans. Prices sit at or below comparable tools while every paid plan stays profitable even if a
 * subscriber uses every AI credit (credits that expire unused move to the community pool and are spent by other
 * people, so planning with 100% use is the honest worst case).
 *
 * Margin check, worst case = every credit used at EST_COST_CENTS_PER_CREDIT, after Stripe's 2.9% + 30¢ (card),
 * excluding hosting, voice and video-render compute:
 *   Creator   $15 / 400 credits   42% monthly · 35% yearly
 *   Pro       $39 / 1,000 credits 45% monthly · 36% yearly
 *   Unlimited $99 / 3,000 credits 36% monthly · 26% yearly
 * At half the credits used (typical) every plan is above 60%. Anyone who needs more buys a credit pack (CREDIT_PACKS),
 * so the heaviest users pay for their own usage instead of eating into the plan's margin.
 *
 * Competitor reference (list prices, costbench.com, Oct 2026): SocialBee $29/$49/$99, Later $25/$50/$110,
 * Metricool $25/$67, ContentStudio $19/$49/$99, SocialPilot $20/$40/$100, Hootsuite $99+.
 */
export type PlanId = "free" | "creator" | "pro" | "unlimited";

export interface Plan {
  id: PlanId;
  name: string;
  monthly: number;
  /** Per-month price when billed yearly */
  annual: number;
  blurb: string;
  credits: number;
  /** Published posts per month; null = unlimited */
  postsPerMonth: number | null;
  /** Max posts per day per platform the user may set; null = the user decides */
  maxPostsPerDay: number | null;
  maxPlatforms: number;
  storageMb: number;
  features: {
    autoReplies: boolean;
    nicheResearch: boolean;
    longStories: boolean;
    bulkImport: boolean;
    repurpose: boolean;
    priorityModel: boolean;
    /** Every piece is written with the full money stack (src/lib/viral.ts). */
    moneyStack: boolean;
  };
  highlights: string[];
  popular?: boolean;
  /**
   * Free trial on the monthly plan: `days` free (card on file, nothing charged), then the first paid month at
   * `firstMonth` dollars, then the normal `monthly` price. Yearly purchases get the free days but no intro month.
   */
  trial?: { days: number; firstMonth: number };
}

/** Length of the free trial on plans that have one. */
export const TRIAL_DAYS = 14;
/**
 * During a free trial, AI writing doesn't use credits up to this many credits' worth a day (about 25 text posts).
 * The plan's own credits arrive in the vault when the first paid month starts, so a trial costs at most
 * 14 days × this amount (350 credits, about $7 of Claude usage) and can't be run up.
 */
export const TRIAL_DAILY_FREE_CREDITS = 25;
/** What the intro month saves (dollars, monthly billing). 0 when the plan has no trial. */
export const introDiscount = (p: Plan) => (p.trial ? Math.max(0, p.monthly - p.trial.firstMonth) : 0);

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    annual: 0,
    blurb: "Try the whole loop on two accounts",
    credits: 30,
    postsPerMonth: 30,
    maxPostsPerDay: 1,
    maxPlatforms: 2,
    storageMb: 250,
    features: { autoReplies: false, nicheResearch: false, longStories: false, bulkImport: false, repurpose: false, priorityModel: false, moneyStack: false },
    highlights: ["30 AI credits a month", "30 published posts a month", "2 connected platforms", "Niche Lab revenue data", "Short story scripts"],
  },
  {
    id: "creator",
    name: "Creator",
    monthly: 15,
    annual: 13,
    blurb: "One faceless channel, posting daily",
    credits: 400,
    postsPerMonth: 300,
    maxPostsPerDay: 3,
    maxPlatforms: 3,
    storageMb: 2_000,
    features: { autoReplies: false, nicheResearch: true, longStories: false, bulkImport: true, repurpose: true, priorityModel: false, moneyStack: false },
    highlights: ["400 AI credits a month", "300 posts a month, up to 3 a day", "3 platforms", "Niche research reports", "Repurpose to every platform", "Bulk CSV import · 2 GB uploads"],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 39,
    annual: 33,
    blurb: "Grow on every platform at once",
    credits: 1_000,
    postsPerMonth: 1_500,
    maxPostsPerDay: 6,
    maxPlatforms: 7,
    storageMb: 10_000,
    popular: true,
    trial: { days: TRIAL_DAYS, firstMonth: 19 },
    features: { autoReplies: true, nicheResearch: true, longStories: true, bulkImport: true, repurpose: true, priorityModel: true, moneyStack: false },
    highlights: ["1,000 AI credits a month", "1,500 posts a month, up to 6 a day", "All 6 platforms + any app via webhook", "Automatic comment replies", "8–10 minute scripts on our strongest model", "10 GB uploads"],
  },
  {
    id: "unlimited",
    name: "Unlimited",
    monthly: 99,
    annual: 84,
    blurb: "No posting limits — you set the pace",
    credits: 3_000,
    postsPerMonth: null,
    maxPostsPerDay: null,
    maxPlatforms: 7,
    storageMb: 50_000,
    trial: { days: TRIAL_DAYS, firstMonth: 49 },
    features: { autoReplies: true, nicheResearch: true, longStories: true, bulkImport: true, repurpose: true, priorityModel: true, moneyStack: true },
    highlights: ["Unlimited posts — you choose posts per day", "3,000 AI credits a month", "Money Stack on every piece: every ad, affiliate, sponsor and search lever", "All 6 platforms + any app via webhook", "Everything in Pro", "Strongest model for long scripts", "50 GB uploads"],
  },
];

/** Strongest model, used for long story scripts on plans with `priorityModel` (Pro and Unlimited). */
export const DEFAULT_PREMIUM_MODEL = "claude-opus-5-5";

/** Credits for a story script. The strongest model costs more to run, so it uses twice the credits. One rule for server and UI. */
export function storyCredits(plan: Plan, long: boolean): number {
  if (!long) return CREDIT_COST.storyShort;
  return CREDIT_COST.storyLong * (plan.features.priorityModel ? 2 : 1);
}

export const planById = (id: string | undefined) => PLANS.find((p) => p.id === id) ?? PLANS[0];

/**
 * Estimated Claude cost of one credit, in cents, used for the admin cost estimate and margin checks. Measured from
 * the app's real prompt sizes at Claude Sonnet 5.5 prices ($2 / $10 per million tokens in / out): 1.6–2.2¢ per credit.
 */
export const EST_COST_CENTS_PER_CREDIT = 2;

/** What each Claude-powered action costs in credits. About 1 credit ≈ 2 cents of Claude usage. */
export const CREDIT_COST = {
  post: 1,
  videoShort: 2,
  videoMid: 4,
  videoLong: 6,
  renderShort: 3,
  renderMid: 6,
  renderLong: 10,
  maximize: 2,
  replies: 1,
  regen: 1,
  plan: 1,
  niche: 4,
  storyShort: 2,
  storyLong: 6,
  repurposePerPlatform: 1,
  /** Added to a piece built from a live story: Claude searches current newsroom coverage (about 9¢ of usage, so 4 credits). */
  liveCheck: 4,
  /**
   * Media made on the app's Gemini key, priced from Google's paid-tier list prices (Oct 2026):
   * a 2K Nano Banana 2.1 picture is $0.0504, so 4 credits (8¢); Veo 3.1 Fast at 720p is $0.10 a second, so 7 credits (14¢).
   */
  aiImage: 4,
  veoSecond: 7,
  /** Seedance 2.5 on Replicate is $0.2312 a second at 720p from an image (Oct 2026), so 16 credits (32¢). */
  seedanceSecond: 16,
  /** Wan 2.2 (open weights) on Replicate is at most $0.145 a ~5-second 720p clip (Oct 2026); 2 credits a second covers it from a 4-second scene up. */
  wanSecond: 2,
  /** A character portrait: one 2K picture plus a short description written from the photo. */
  character: 5,
  explain: 1,
  /** Writers' Room: long structured writing, priced like the long story script (feature and series outlines run about twice as long). */
  filmDevelop: 6,
  filmDevelopLong: 10,
  filmPage: 2,
  filmReview: 3,
  filmPromo: 2,
  /**
   * Ghost Post Video Engine on the owner's GPU. Wan 2.2 A14B takes about 1,056 s for a 5-second 720p clip on one
   * H100 (Novita AI's figure; an A100 is slower), and Azure's A100 VM is $3.673 an hour in East US (Oct 2026), so a
   * second of footage costs roughly 20–35¢. 16 credits (32¢ at the cost basis, 53–62¢ charged) keeps it profitable;
   * lower it once your own timings show a faster GPU.
   */
  ownSecond: 16,
  /**
   * Music and sound effects on the same GPU (Library generators). ACE-Step 1.5 turbo makes a full song in well under a
   * minute even on a 24 GB card and MOSS-SoundEffect v2 a 30-second sound in about a minute, a few cents of GPU time
   * each at the A100 price above; the prices keep the same margin as footage.
   */
  aiMusic: 6,
  aiSfx: 3,
  /** AI Voiceover on the app's own server (Kokoro): per started 1,000 characters. */
  voiceover: 1,
  /** Speech on the GPU (Chatterbox, 23 languages, My Voices): per started 1,000 characters. */
  speech: 2,
  /** Voice-to-voice, per started minute of recording. */
  voiceChangeMinute: 3,
  /** Dubbing a video into another language (hearing, translating, speaking every line), per started minute. */
  dubMinute: 12,
  /** Lip sync (MuseTalk), per started second of speech. */
  lipsyncSecond: 2,
  /** Voice design (Parler-TTS on the GPU): one sample in a new voice described in words. */
  voiceDesign: 2,
  /** Voice isolator (Demucs on the GPU), per started minute. */
  isolateMinute: 1,
  /** Turn a short idea into a full generator prompt. */
  autoPrompt: 1,
  /** Film Engine: plan a whole film as Seedance beats with timestamped shot lists, or write one more beat. */
  filmPlan: 4,
  filmBeat: 1,
} as const;
export type CreditAction = keyof typeof CREDIT_COST;

export const CREDIT_LABEL: Record<CreditAction, string> = {
  post: "Write a text post",
  videoShort: "Video post plan — short (each)",
  videoMid: "Video post plan — 3 minutes (each)",
  videoLong: "Video post plan — long-form (each)",
  renderShort: "Render a short video (voice, visuals, captions)",
  renderMid: "Render a 3-minute video",
  renderLong: "Render a long-form video",
  maximize: "Maximize money rewrite",
  replies: "Draft a batch of up to 10 replies",
  regen: "Rewrite one reply",
  plan: "AI posting-time plan",
  niche: "Niche research report",
  storyShort: "Short story script",
  storyLong: "Long story script (8–10 min)",
  repurposePerPlatform: "Repurpose to one platform",
  liveCheck: "Live fact-check of a news piece (added to the post or video)",
  aiImage: "AI picture for one movie or explainer scene",
  veoSecond: "Each second of a scene animated by Gemini Omni Flash (or Veo), 4–8 seconds per scene",
  seedanceSecond: "Each second of a Seedance 2.5-animated scene (4–8 seconds per scene)",
  wanSecond: "Each second of a Wan 2.2-animated scene (4–8 seconds per scene)",
  character: "Create a character from a photo or description",
  explain: "Explain a text in plain language (2 credits over 8,000 characters)",
  aiMusic: "AI Music: one track up to 4 minutes, with the license",
  aiSfx: "AI Sound Effects: one sound up to 30 seconds, with the license",
  autoPrompt: "Auto-prompt: turn a short idea into a full prompt",
  voiceover: "AI Voiceover: each started 1,000 characters",
  speech: "Voiceover in 23 languages or in one of My Voices: each started 1,000 characters",
  voiceChangeMinute: "Voice changer: each started minute",
  dubMinute: "Dubbing into another language: each started minute",
  lipsyncSecond: "Lip sync and avatars: each started second of speech",
  voiceDesign: "Voice design: a new voice from a description",
  isolateMinute: "Voice isolator: each started minute",
  filmDevelop: "Writers' Room: develop or revise a short film (titles, characters, world, structure, scene outline)",
  filmDevelopLong: "Writers' Room: develop or revise a feature film or series pilot",
  filmPage: "Writers' Room: screenplay pages, per scene",
  filmReview: "Writers' Room: awards-readiness review",
  filmPromo: "Writers' Room: promotion kit",
  ownSecond: "Each second of footage from Ghost Post's own video engine",
  filmPlan: "Film Engine: plan a film as beats with timestamped shot lists",
  filmBeat: "Film Engine: write the next beat",
};

/**
 * Credit packs: one-time purchases for people who use more than their plan includes, so heavy use is paid by the
 * person using it. Each pack costs more per credit than Unlimited, the best-value plan (so subscribing stays the better
 * deal), and keeps at least 20% margin after Stripe's fee even if every credit goes to the most expensive writing; video credits cost
 * less than that (Gemini 1.43¢, Seedance 1.45¢ a credit), so packs used for video earn more. Pack credits last
 * PACK_DAYS, not 30 days, because they were bought outright.
 */
export interface CreditPack {
  id: "small" | "medium" | "large";
  credits: number;
  /** Price in dollars. */
  price: number;
  label: string;
}
export const CREDIT_PACKS: CreditPack[] = [
  { id: "small", credits: 300, price: 12, label: "About 40 seconds of Gemini video, or 300 posts" },
  { id: "medium", credits: 1_000, price: 35, label: "About 2 minutes of Gemini video" },
  { id: "large", credits: 3_000, price: 90, label: "About 7 minutes of Gemini video" },
];
export const packById = (id: string | undefined) => CREDIT_PACKS.find((p) => p.id === id);

/** Hard safety ceiling even on Unlimited: beyond this, platforms treat accounts as spam. */
export const ABSOLUTE_MAX_POSTS_PER_DAY = 50;
