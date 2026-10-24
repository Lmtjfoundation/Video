export const PLATFORMS = ["x", "facebook", "linkedin", "instagram", "youtube", "tiktok", "webhook"] as const;
/** Networks that can hold extra accounts besides the main one (Facebook switches between Pages and the profile on its card). */
export const MULTI_ACCOUNT: readonly Platform[] = ["instagram", "tiktok", "youtube", "x", "linkedin"];
export const MAX_EXTRA_ACCOUNTS = 9;
export type Platform = (typeof PLATFORMS)[number];

export const PILLARS = ["ai_leverage", "high_agency", "wealth_systems", "relationships", "longevity"] as const;
export type Pillar = (typeof PILLARS)[number];

export const FORMATS = ["short", "thread", "carousel", "video_script", "caption"] as const;
export type Format = (typeof FORMATS)[number];

export const REPLY_MODES = ["auto", "quick_witty", "deep_insight", "supportive", "candid", "value_add"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

/**
 * Where a post goes on platforms with more than one surface (Instagram, Facebook Pages).
 * "auto" picks for you: videos become Reels (Facebook: Reels up to 90 seconds, longer videos post to the feed),
 * pictures go to the feed (several pictures become a carousel / multi-photo post).
 */
export const PLACEMENTS = ["auto", "reel", "feed", "story"] as const;
export type Placement = (typeof PLACEMENTS)[number];

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
  /** A finished MP4 hosted outside the app (e.g. an episode from Claude's content inbox). Used when no video is attached. */
  videoUrl?: string;
  /** Uploaded media attached to this post (Media library ids) */
  mediaIds?: string[];
  /** Mature (18+) post — X only, never auto-published */
  mature?: boolean;
  /** "claude-batch" when Claude wrote it in a scheduled cloud session and the app imported it; "trend-autopilot" when Trend Autopilot wrote it */
  source?: "claude-batch" | "trend-autopilot";
  /** Content genre (src/lib/genres.ts), e.g. "black_america" */
  genre?: string;
  /** The reporting a news-based post was built from, so it can be checked before posting */
  sources?: { name: string; url: string }[];
  /** Admin's note when a post is rejected or edited in review */
  reviewNote?: string;
  /**
   * Set when a post is meant for the person's own Facebook profile. Facebook doesn't let apps post to profiles,
   * so at its time the post is prepared (HD video + caption) and handed to the person to post with one tap.
   */
  handoff?: { to: "facebook_profile"; readyAt: string; notifiedAt?: string; postedAt?: string };
  /** Which account on the network posts it: an extra account's id (Platforms tab). Missing = the main account. */
  account?: string;
  /** Instagram / Facebook surface: Reel, feed post or Story. Missing = the account's default (Settings → Auto-post). */
  placement?: Placement;
  /** Publish as soon as it's ready: text right after it's written, videos as soon as the render finishes. */
  autoPost?: boolean;
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
  /** Videos are faceless (voiceover + visuals, nobody on camera). On by default. */
  faceless: boolean;
  /** Content genres this account focuses on (src/lib/genres.ts). */
  genres: string[];
  trendAutopilot: TrendAutopilotSettings;
  /** Email me when a post for my Facebook profile is ready to post. */
  handoffEmail: boolean;
  autoPost: AutoPostSettings;
}

/** Post new content automatically the moment it's generated (videos: as soon as they're rendered). */
export interface AutoPostSettings {
  /** Default for the "Post automatically" switch in Content Studio and Movie Studio. */
  enabled: boolean;
  /** Default placement for Instagram and Facebook posts. */
  instagram: Placement;
  facebook: Placement;
}

/** Trend Autopilot: writes posts (and optionally videos) from live news in the chosen genres into open slots. */
export interface TrendAutopilotSettings {
  enabled: boolean;
  /** "schedule" fills open calendar slots (they publish when Autopilot publishing is on); "drafts" only writes drafts. */
  mode: "schedule" | "drafts";
  /** Also write a video plan per run for TikTok / YouTube / Instagram / Facebook when they're on. */
  videos: boolean;
  videoLength: VideoPlan["length"];
  /** Render those video plans into MP4s automatically (uses render credits). */
  autoRender: boolean;
}

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "video" | "audio";
  storagePath: string;
  createdAt: string;
  /** True for MP4s the app rendered from a video plan */
  rendered?: boolean;
  durationSec?: number;
  /** Where the file was downloaded from, so one remote video is stored once and shared by several posts */
  sourceUrl?: string;
}

export interface Story {
  id: string;
  createdAt: string;
  niche: string;
  format: "short" | "tiktok" | "long" | "episode";
  type: "true" | "funny" | "explainer" | "fiction";
  topic: string;
  sources: string[];
  /** Set for episodes of a series, e.g. imported from Claude's content inbox */
  series?: { name: string; season: number; episode: number };
  /** Finished, voiced video of this story when one exists */
  videoUrl?: string;
  out: {
    label?: string;
    titles?: { title: string; why?: string }[];
    hook?: string;
    scenes: { time?: string; heading?: string; narration: string; onScreen?: string; visual?: string; audio?: string }[];
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
  /** Facebook: the Pages this login can post to (names only). */
  choices?: { id: string; name: string }[];
  /** Facebook: "page" posts automatically; "profile" means the person's own profile, posted with one tap. */
  mode?: "page" | "profile";
  /** Facebook: the person's profile name, when known, so they can switch between a Page and their profile. */
  profileName?: string;
  /** Facebook profile: posts go out automatically through Instagram's own sharing to Facebook. */
  viaInstagram?: boolean;
  /** Extra accounts on this network besides the main one (Metricool-style), e.g. a second Instagram. */
  accounts?: { id: string; handle?: string; method?: string; updatedAt?: string }[];
  /** "metricool" when this platform posts through the person's Metricool connection. */
  via?: "metricool";
  /** Connected directly in Ghost Post (its own sign-in or token), as opposed to only through Metricool. */
  direct?: boolean;
}

/** Decrypted platform credential (server only). */
export interface Credential {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  /** X user id, LinkedIn author URN, IG user id, YouTube channel id */
  accountId?: string;
  handle?: string;
  /** "oauth" | "manual" | "profile" */
  method?: string;
  /** Facebook: "page" (automatic posting) or "profile" (the person's own profile, posted with one tap). */
  mode?: string;
  /** Facebook: the person's own profile. The id is app-scoped (from Facebook Login); the link is optional. */
  profileId?: string;
  profileName?: string;
  profileUrl?: string;
  /** Facebook profile: "1" when posts go out through Instagram, whose own "Share to Facebook" setting puts them on the profile. */
  viaInstagram?: string;
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
  /** Names of library characters who appear in this scene (AI-pictured videos only). */
  cast?: string[];
  /** A picture or clip from the Media Library chosen for this scene (timeline "swap picture"): used instead of an AI picture or stock footage. */
  mediaId?: string;
  /**
   * The AI picture last painted for this scene and what it was painted from. A re-render reuses it while the scene's
   * shot, cast and style are unchanged, so editing one scene repaints only that scene.
   */
  painted?: { mediaId: string; key: string };
}

/** AI-made visuals for a video: every scene is pictured with Gemini, and chosen scenes are animated with Google Veo. */
export interface AiVisuals {
  /** Characters (Characters library ids) who appear in this video. */
  characterIds: string[];
  /** Art direction used for every picture, e.g. "Pixar-style 3D animation". */
  look: string;
  /** Indexes into `scenes` that are animated (with Veo, or Seedance); the rest are AI pictures with a slow camera move. */
  veoScenes: number[];
  /** Which model animates those scenes: Veo (Google), Seedance 2.5 (ByteDance) or Wan 2.2 (open weights). Missing = Veo. */
  engine?: AnimationEngine;
}
export const ANIMATION_ENGINES = ["veo", "seedance", "wan"] as const;
export type AnimationEngine = (typeof ANIMATION_ENGINES)[number];

/** A reusable character for movies and explainers, made from a photo or a description. */
export interface Character {
  id: string;
  name: string;
  /** Appearance, outfit and personality, used to keep the character the same in every scene. */
  description: string;
  look: string;
  /** The character portrait (Media library id) used as the reference picture in every scene. */
  imageMediaId: string;
  /** The photo it was made from, when there was one. */
  sourceMediaId?: string;
  createdAt: string;
}

/** Production-ready plan for a faceless video post. */
export interface VideoPlan {
  niche: string;
  style: "true" | "funny" | "explainer" | "countdown" | "fiction";
  length: "s30" | "s60" | "s90" | "m3" | "m10" | "long";
  topic?: string;
  titles: string[];
  thumbnail: { text?: string; prompt?: string };
  voice: string;
  music: string;
  scenes: VideoScene[];
  loopLine: string;
  factCheck: string[];
  /** Set when the visuals are AI pictures and Veo clips instead of stock footage. */
  ai?: AiVisuals;
  /** false = no narration audio (captions, visuals and music only). Missing = on. */
  voiceover?: boolean;
  /** "motion" = Ghost Post's motion graphics for every scene; "auto" (or missing) = stock footage or AI pictures. */
  visuals?: VideoVisuals;
  /**
   * Audio to video: an uploaded recording (Media Library id) is the soundtrack, played as it is. Scene i is shown
   * from cuts[i].start to cuts[i].end (seconds), so the pictures follow what is heard. No narrator is added.
   */
  audio?: { mediaId: string; cuts: { start: number; end: number }[] };
}
export const VIDEO_VISUALS = ["auto", "motion"] as const;
export type VideoVisuals = (typeof VIDEO_VISUALS)[number];
