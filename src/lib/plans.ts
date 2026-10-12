/**
 * Subscription plans. Prices are set to undercut comparable tools while staying profitable:
 * every paid plan is profitable even if a subscriber uses every AI credit (see /admin → Revenue).
 * Competitor reference (2026 list prices): SocialBee $29/$49/$99, Later $25/$50/$110,
 * AutoShorts $19/$39/$69, OpusClip $15/$29.
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
  };
  highlights: string[];
  popular?: boolean;
}

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
    features: { autoReplies: false, nicheResearch: false, longStories: false, bulkImport: false, repurpose: false, priorityModel: false },
    highlights: ["30 AI credits a month", "30 published posts a month", "2 connected platforms", "Niche Lab revenue data", "Short story scripts"],
  },
  {
    id: "creator",
    name: "Creator",
    monthly: 12,
    annual: 10,
    blurb: "One faceless channel, posting daily",
    credits: 400,
    postsPerMonth: 300,
    maxPostsPerDay: 3,
    maxPlatforms: 3,
    storageMb: 2_000,
    features: { autoReplies: false, nicheResearch: true, longStories: false, bulkImport: true, repurpose: true, priorityModel: false },
    highlights: ["400 AI credits a month", "300 posts a month, up to 3 a day", "3 platforms", "Niche research reports", "Repurpose to every platform", "Bulk CSV import · 2 GB uploads"],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 29,
    annual: 24,
    blurb: "Grow on every platform at once",
    credits: 1_200,
    postsPerMonth: 1_500,
    maxPostsPerDay: 6,
    maxPlatforms: 6,
    storageMb: 10_000,
    popular: true,
    features: { autoReplies: true, nicheResearch: true, longStories: true, bulkImport: true, repurpose: true, priorityModel: false },
    highlights: ["1,200 AI credits a month", "1,500 posts a month, up to 6 a day", "All 6 platforms", "Automatic comment replies", "8–10 minute story scripts", "10 GB uploads"],
  },
  {
    id: "unlimited",
    name: "Unlimited",
    monthly: 59,
    annual: 49,
    blurb: "No posting limits — you set the pace",
    credits: 3_500,
    postsPerMonth: null,
    maxPostsPerDay: null,
    maxPlatforms: 6,
    storageMb: 50_000,
    features: { autoReplies: true, nicheResearch: true, longStories: true, bulkImport: true, repurpose: true, priorityModel: true },
    highlights: ["Unlimited posts — you choose posts per day", "3,500 AI credits a month", "All 6 platforms", "Everything in Pro", "Strongest model for long scripts", "50 GB uploads"],
  },
];

export const planById = (id: string | undefined) => PLANS.find((p) => p.id === id) ?? PLANS[0];

/** What each Claude-powered action costs in credits. ~1 credit ≈ 1 cent of AI cost at most. */
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
};

/** Hard safety ceiling even on Unlimited: beyond this, platforms treat accounts as spam. */
export const ABSOLUTE_MAX_POSTS_PER_DAY = 50;
