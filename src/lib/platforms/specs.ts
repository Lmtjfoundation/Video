import type { Format, Platform } from "../types";

export interface PlatformSpec {
  name: string;
  short: string;
  /** Tailwind classes for the platform chip */
  chip: string;
  maxChars: number;
  threadPartChars?: number;
  maxHashtags: number;
  recommendedHashtags: string;
  formats: Format[];
  /** Plain-language capability summary shown in Settings */
  publish: string;
  engage: string;
  writingRules: string;
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  x: {
    name: "X (Twitter)",
    short: "X",
    chip: "bg-white/10 text-white ring-white/20",
    maxChars: 280,
    threadPartChars: 270,
    maxHashtags: 2,
    recommendedHashtags: "0–1",
    formats: ["short", "thread"],
    publish: "Automatic via X API v2 (paid API tier needed for real volume).",
    engage: "Automatic reply monitoring via recent search (requires a paid API tier).",
    writingRules:
      "Standard accounts: 280 characters per post. Threads: 4–8 parts, each under 270 characters, first part is the hook, last part is a takeaway. Hashtags rarely help on X; use 0–1. Line breaks for rhythm.",
  },
  facebook: {
    name: "Facebook",
    short: "f",
    chip: "bg-blue-500/15 text-blue-300 ring-blue-400/30",
    maxChars: 63206,
    maxHashtags: 3,
    recommendedHashtags: "0–2",
    formats: ["short", "caption", "video_script"],
    publish: "Pages: automatic text and video posts (Graph API). Profiles, including monetized profiles in professional mode: each post is ready at its time with the HD video and caption, and you post it with one tap — Facebook doesn't let any app post to profiles.",
    engage: "Pages: automatic comment monitoring and replies. Profiles: reply in the Facebook app (no API access to profile comments).",
    writingRules:
      "Facebook post (Page or personal profile): 80–250 words performs well; the first 1–2 lines show before 'See more', so the hook must land there. Conversational, story-led, short paragraphs. Ask one specific question to drive comments. 0–2 hashtags. Reels: video_script with beats in parts.",
  },
  linkedin: {
    name: "LinkedIn",
    short: "in",
    chip: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
    maxChars: 3000,
    maxHashtags: 5,
    recommendedHashtags: "2–3",
    formats: ["short", "carousel"],
    publish: "Automatic via LinkedIn Posts API (w_member_social scope).",
    engage: "Copy-ready. Reading comments needs LinkedIn Community Management API approval.",
    writingRules:
      "Up to 3,000 characters, but 700–1,300 performs well. The first ~210 characters show before 'see more', so the hook must land there. Short paragraphs, no walls of text, professional but human. 2–3 hashtags at the end. Carousels: give slide-by-slide text in parts.",
  },
  instagram: {
    name: "Instagram",
    short: "IG",
    chip: "bg-pink-500/15 text-pink-300 ring-pink-400/30",
    maxChars: 2200,
    maxHashtags: 30,
    recommendedHashtags: "3–5",
    formats: ["caption", "carousel", "video_script"],
    publish: "Automatic via Instagram Graph API for Business/Creator accounts — requires a public image URL.",
    engage: "Automatic comment monitoring and replies via Instagram Graph API.",
    writingRules:
      "Caption up to 2,200 characters; the first line is the hook (about 125 characters show before truncation). Carousels: 6–10 slides with one idea per slide in parts. Reels: video_script with on-screen text and spoken lines in parts. 3–5 relevant hashtags.",
  },
  youtube: {
    name: "YouTube",
    short: "YT",
    chip: "bg-red-500/15 text-red-300 ring-red-400/30",
    maxChars: 5000,
    maxHashtags: 3,
    recommendedHashtags: "1–3",
    formats: ["video_script"],
    publish: "Copy-ready scripts. Video upload is not automated in this version; Community posts have no public API.",
    engage: "Automatic comment monitoring and replies via YouTube Data API v3.",
    writingRules:
      "Shorts script under 60 seconds: hook in the first 2 seconds, 5–8 beats in parts, end with a loop or a question. The body is the video description; put the title in the hook (under 100 characters).",
  },
  tiktok: {
    name: "TikTok",
    short: "TT",
    chip: "bg-cyan-400/15 text-cyan-200 ring-cyan-300/30",
    maxChars: 2200,
    maxHashtags: 5,
    recommendedHashtags: "3–5",
    formats: ["video_script", "caption"],
    publish: "Copy-ready. Direct posting requires TikTok's Content Posting API audit; unaudited apps can only post privately.",
    engage: "Copy-ready. TikTok does not offer a general comment-reply API.",
    writingRules:
      "Video script 20–45 seconds: pattern-interrupt hook in the first second, on-screen text plus spoken lines in parts, conversational. Caption short with 3–5 hashtags.",
  },
  webhook: {
    name: "Any app (webhook)",
    short: "↗",
    chip: "bg-violet-400/15 text-violet-200 ring-violet-300/30",
    maxChars: 3000,
    maxHashtags: 5,
    recommendedHashtags: "2–3",
    formats: ["short", "caption", "carousel"],
    publish: "Sends each post as JSON to a webhook URL you choose (Zapier, Make, n8n, Slack, Discord, your own server). That tool then posts it to whatever app you use.",
    engage: "Not available: a webhook only sends posts out.",
    writingRules:
      "General-purpose post up to 3,000 characters, plain text, short paragraphs, a hook in the first line. 2–3 hashtags at the end. Carousels: slide-by-slide text in parts.",
  },
};
