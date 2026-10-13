export const PLATFORMS = ["x", "facebook", "linkedin", "instagram", "youtube", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PILLARS = ["ai_leverage", "high_agency", "wealth_systems", "relationships", "longevity"] as const;
export type Pillar = (typeof PILLARS)[number];

export const FORMATS = ["short", "thread", "carousel", "video_script", "caption"] as const;
export type Format = (typeof FORMATS)[number];

export const REPLY_MODES = ["auto", "quick_witty", "deep_insight", "supportive", "candid", "value_add"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

export type PostStatus =
  | "draft"
  | "pending_review" // waiting for an admin to approve
  | "rejected" // admin sent it back with a note
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "copy_ready";
export type ReplyStatus =
  | "pending_approval"
  | "approved"
  | "sending"
  | "sent"
  | "skipped"
  | "blocked"
  | "escalated"
  | "failed";

export interface RevenueEstimate {
  low: number;
  high: number;
  basis: string;
}

export interface Post {
  id: string;
  platform: Platform;
  pillar: Pillar;
  format: Format;
  topic?: string;
  hook: string;
  body: string;
  /** Thread parts / carousel slides / script beats. Empty for single posts. */
  parts: string[];
  hashtags: string[];
  cta?: string;
  offerId?: string | null;
  moneyAngle?: string;
  imageUrl?: string;
  /** Uploaded media attached to this post (Media library ids) */
  mediaIds?: string[];
  /** Mature (18+) post — X only, never auto-published */
  mature?: boolean;
  /** "claude-batch" when Claude wrote it in a scheduled cloud session and the app imported it */
  source?: "claude-batch";
  /** Admin's note when a post is rejected or edited in review */
  reviewNote?: string;
  /** "video" posts carry a full production plan in `video` */
  kind?: "text" | "video";
  video?: VideoPlan;
  /** Server-side video render progress for video posts */
  render?: { status: "queued" | "rendering" | "done" | "failed"; progress: number; message?: string; mediaId?: string; credits?: number; updatedAt: string };
  status: PostStatus;
  scheduledAt?: string;
  publishedAt?: string;
  moneyScore: number;
  revenue: RevenueEstimate;
  scoreNotes: string[];
  safetyFlags: string[];
  attempts: number;
  externalId?: string;
  externalIds?: string[];
  externalUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialComment {
  id: string;
  platform: Platform;
  postId?: string;
  postExternalId: string;
  externalId: string;
  author: string;
  authorFollowers?: number;
  text: string;
  createdAt: string;
  priority: number;
  handled: boolean;
}

export interface Reply {
  id: string;
  commentId: string;
  platform: Platform;
  postId?: string;
  postExternalId: string;
  commentExternalId: string;
  author: string;
  commentText: string;
  mode: ReplyMode;
  text: string;
  status: ReplyStatus;
  priority: number;
  safetyFlags: string[];
  externalId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export type LogLevel = "info" | "warn" | "error";
export type LogKind = "post" | "reply" | "schedule" | "safety" | "system" | "generate" | "engage";

export interface LogEntry {
  id: string;
  at: string;
  level: LogLevel;
  kind: LogKind;
  platform?: Platform;
  message: string;
  meta?: Record<string, unknown>;
}

export interface Offer {
  id: string;
  name: string;
  url: string;
  pillar: Pillar | "any";
  /** Average payout per conversion, USD. Used only for estimates. */
  commissionUsd: number;
  notes?: string;
}

export interface PlatformLimits {
  postsPerDay: number;
  repliesPerHour: number;
  repliesPerDay: number;
  /** Minimum seconds between any two write actions on this platform. */
  minGapSec: number;
}

export interface AudienceInputs {
  followers: number;
  /** Fraction of followers who typically see a post (0–1). */
  reachRate: number;
}

export interface Settings {
  autopilot: boolean;
  killSwitch: boolean;
  autoReply: boolean;
  requireReplyApproval: boolean;
  timezone: string;
  postsPerDay: number;
  platforms: Record<Platform, boolean>;
  /** Set once Instagram and TikTok were switched on for this account (they started off by default). */
  platformsV2?: boolean;
  slots: Record<Platform, string[]>;
  quietHours: { enabled: boolean; start: string; end: string };
  limits: Record<Platform, PlatformLimits>;
  audience: Record<Platform, AudienceInputs>;
  /** Your revenue per 1,000 views from platform payouts / ads, USD. */
  rpmUsd: number;
  affiliateCtr: number;
  affiliateConversion: number;
  offers: Offer[];
  disclosure: string;
  brandVoiceNotes: string;
  defaultReplyMode: ReplyMode;
  pillarMix: Record<Pillar, number>;
  /** X only: allow mature (18+) adult-perspective posts. Never explicit; never auto-published. */
  matureX: boolean;
  /** User confirmed their X account has "Mark media you post as containing sensitive material" turned on */
  xSensitiveConfirmed: boolean;
}

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "video";
  storagePath: string;
  createdAt: string;
  /** True for MP4s the app rendered from a video plan */
  rendered?: boolean;
  durationSec?: number;
}

export interface Story {
  id: string;
  createdAt: string;
  niche: string;
  format: "short" | "tiktok" | "long";
  type: "true" | "funny" | "explainer" | "fiction";
  topic: string;
  sources: string[];
  out: {
    label?: string;
    titles?: { title: string; why?: string }[];
    hook?: string;
    scenes: { time?: string; narration: string; onScreen?: string; visual?: string; audio?: string }[];
    ending?: string;
    cta?: string;
    description?: string;
    tags?: string[];
    thumbnailText?: string[];
    pinnedComment?: string;
    factCheck?: string[];
    monetization?: string;
    runtimeSec?: number;
  };
}

export interface NicheReport {
  id: string;
  createdAt: string;
  input: { interests: string; platform: string; hours: string; goal: string };
  /** "builtin" = curated picks shown without Claude research */
  source?: "claude" | "builtin";
  note?: string;
  summary: string;
  niches: {
    name: string;
    dataNiche?: string;
    whyItEarns?: string;
    rpmBasis?: string;
    competition?: string;
    facelessFormat?: string;
    audience?: string;
    storyIdeas?: { title: string; hook?: string; type?: string }[];
    monetization?: string[];
    risks?: string[];
    first30Days?: string[];
  }[];
}

export interface CredentialStatus {
  platform: Platform;
  connected: boolean;
  fields: string[];
  updatedAt?: string;
  /** Account name shown in the UI, e.g. @handle or channel title */
  handle?: string;
  /** When the access token expires (refreshed automatically where the platform allows) */
  expiresAt?: string;
  /** "oauth" when linked with the platform's sign-in, "manual" when a token was pasted */
  method?: string;
  /** Whether the app has client credentials configured for one-click linking */
  oauthReady: boolean;
  /** Where the app keys came from: environment variables or the in-app Setup Wizard */
  keySource?: "env" | "app";
  /** Masked app ID, e.g. "1234…5678" */
  keyPreview?: string;
  /** Facebook: the Pages this login can post to (names only), when there's more than one. */
  choices?: { id: string; name: string }[];
}

/** Decrypted platform credential (server only). */
export interface Credential {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  /** X user id, LinkedIn author URN, IG user id, YouTube channel id */
  accountId?: string;
  handle?: string;
  /** "oauth" | "manual" */
  method?: string;
  scopes?: string;
  refreshExpiresAt?: string;
  connectedAt?: string;
}

export interface VideoScene {
  time: string;
  narration: string;
  onScreen: string;
  visual: string;
  motion: string;
  sfx: string;
}

/** Production-ready plan for a faceless video post. */
export interface VideoPlan {
  niche: string;
  style: "true" | "funny" | "explainer" | "countdown" | "fiction";
  length: "s30" | "s60" | "s90" | "m3" | "long";
  topic?: string;
  titles: string[];
  thumbnail: { text?: string; prompt?: string };
  voice: string;
  music: string;
  scenes: VideoScene[];
  loopLine: string;
  factCheck: string[];
}
