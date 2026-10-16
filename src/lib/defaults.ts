import type { Settings } from "./types";
import { PLATFORMS } from "./types";

/**
 * Posting slots are common starting points from public industry studies, not guarantees.
 * Replace them with times from your own analytics after 2–3 weeks of data.
 *
 * Rate limits are deliberately conservative defaults chosen by this app — they are NOT
 * official platform numbers. Platforms do not publish exact anti-spam thresholds.
 */
export const DEFAULT_SETTINGS: Settings = {
  autopilot: false,
  killSwitch: false,
  autoReply: false,
  requireReplyApproval: true,
  timezone: "America/Chicago",
  postsPerDay: 3,
  platforms: { x: true, facebook: false, linkedin: true, instagram: true, youtube: false, tiktok: true, webhook: false },
  slots: {
    x: ["08:30", "12:15", "18:45"],
    facebook: ["09:00", "13:00", "19:00"],
    linkedin: ["07:45", "12:00", "17:30"],
    instagram: ["11:00", "14:00", "19:30"],
    youtube: ["12:00", "15:00", "18:00"],
    tiktok: ["12:00", "17:00", "20:30"],
    webhook: ["09:00", "13:00", "18:00"],
  },
  quietHours: { enabled: true, start: "23:30", end: "06:30" },
  limits: {
    x: { postsPerDay: 6, repliesPerHour: 12, repliesPerDay: 60, minGapSec: 90 },
    facebook: { postsPerDay: 3, repliesPerHour: 12, repliesPerDay: 60, minGapSec: 90 },
    linkedin: { postsPerDay: 3, repliesPerHour: 8, repliesPerDay: 30, minGapSec: 120 },
    instagram: { postsPerDay: 4, repliesPerHour: 15, repliesPerDay: 80, minGapSec: 75 },
    youtube: { postsPerDay: 2, repliesPerHour: 15, repliesPerDay: 80, minGapSec: 75 },
    tiktok: { postsPerDay: 3, repliesPerHour: 10, repliesPerDay: 50, minGapSec: 90 },
    webhook: { postsPerDay: 6, repliesPerHour: 0, repliesPerDay: 0, minGapSec: 30 },
  },
  audience: {
    x: { followers: 1000, reachRate: 0.12 },
    facebook: { followers: 1000, reachRate: 0.06 },
    linkedin: { followers: 1000, reachRate: 0.1 },
    instagram: { followers: 1000, reachRate: 0.2 },
    youtube: { followers: 1000, reachRate: 0.1 },
    tiktok: { followers: 1000, reachRate: 0.4 },
    webhook: { followers: 1000, reachRate: 0.1 },
  },
  rpmUsd: 3,
  affiliateCtr: 0.006,
  affiliateConversion: 0.02,
  offers: [],
  disclosure: "#ad — I may earn a commission if you buy through this link.",
  brandVoiceNotes: "",
  defaultReplyMode: "auto",
  matureX: false,
  xSensitiveConfirmed: false,
  faceless: true,
  genres: ["trending", "black_america", "money", "tech_ai"],
  trendAutopilot: { enabled: false, mode: "schedule", videos: true, videoLength: "s90", autoRender: false },
  handoffEmail: true,
  pillarMix: {
    wealth_systems: 30,
    ai_leverage: 30,
    high_agency: 20,
    relationships: 10,
    longevity: 10,
  },
};

export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const s = stored ?? {};
  const d = DEFAULT_SETTINGS;
  const platforms = { ...d.platforms, ...(s.platforms ?? {}) };
  // One-time: Instagram and TikTok used to start switched off; turn them on for existing accounts once.
  if (!s.platformsV2) {
    platforms.instagram = true;
    platforms.tiktok = true;
  }
  return {
    ...d,
    ...s,
    platformsV2: true,
    platforms,
    slots: { ...d.slots, ...(s.slots ?? {}) },
    quietHours: { ...d.quietHours, ...(s.quietHours ?? {}) },
    limits: Object.fromEntries(PLATFORMS.map((p) => [p, { ...d.limits[p], ...(s.limits?.[p] ?? {}) }])) as Settings["limits"],
    audience: Object.fromEntries(PLATFORMS.map((p) => [p, { ...d.audience[p], ...(s.audience?.[p] ?? {}) }])) as Settings["audience"],
    pillarMix: { ...d.pillarMix, ...(s.pillarMix ?? {}) },
    offers: Array.isArray(s.offers) ? s.offers : d.offers,
    genres: Array.isArray(s.genres) && s.genres.length ? s.genres : d.genres,
    trendAutopilot: { ...d.trendAutopilot, ...(s.trendAutopilot ?? {}) },
  };
}
