import type { Placement, Platform } from "../types";

/**
 * Picks the exact Instagram / Facebook surface for a post from its placement and media, so every kind of content
 * can be published without a person choosing: Reels, feed posts (single photo, carousel / multi-photo), Stories.
 * Limits from Meta's publishing docs: Facebook Reels 3–90 s, Stories (Facebook and Instagram) up to 60 s,
 * Instagram carousels up to 10 items.
 */
export type Surface =
  | "ig_reel" | "ig_story_video" | "ig_story_image" | "ig_image" | "ig_carousel"
  | "fb_reel" | "fb_video" | "fb_story_video" | "fb_story_photo" | "fb_photo" | "fb_photos" | "fb_text";

export interface SurfaceInput {
  /** Set when the post carries a finished video. Unknown duration/orientation counts as "can't promise a Reel". */
  video?: { durationSec?: number; portrait?: boolean };
  /** Public image URLs available for the post (attached pictures or the image URL). */
  images: number;
}

export const FB_REEL_MAX_SEC = 90;
export const STORY_MAX_SEC = 60;
export const CAROUSEL_MAX = 10;

/** The surface to publish to, or a plain-language reason it can't be published automatically. */
export function resolveSurface(platform: Platform, placement: Placement | undefined, m: SurfaceInput): Surface | { error: string } {
  const p = placement ?? "auto";
  const dur = m.video?.durationSec;
  if (platform === "instagram") {
    if (m.video) {
      if (p === "story") return dur && dur > STORY_MAX_SEC ? { error: `Instagram Stories are up to ${STORY_MAX_SEC} seconds; this video is ${Math.round(dur)}. Choose Reel instead.` } : "ig_story_video";
      return "ig_reel"; // Instagram's API publishes feed videos as Reels shared to the feed
    }
    if (!m.images) return { error: "Instagram needs a picture or a video. Attach one from the Media Library, or add an image URL." };
    if (p === "story") return "ig_story_image";
    return m.images > 1 ? "ig_carousel" : "ig_image";
  }
  if (platform === "facebook") {
    if (m.video) {
      if (p === "story") return dur && dur > STORY_MAX_SEC ? { error: `Facebook Stories are up to ${STORY_MAX_SEC} seconds; this video is ${Math.round(dur)}. Choose Reel or Feed instead.` } : "fb_story_video";
      const reelOk = !!dur && dur >= 3 && dur <= FB_REEL_MAX_SEC && m.video.portrait !== false;
      if (p === "reel") return reelOk || !dur ? "fb_reel" : "fb_video"; // longer than a Reel allows: post it as a feed video instead
      if (p === "feed") return "fb_video";
      return reelOk ? "fb_reel" : "fb_video";
    }
    if (p === "story") return m.images ? "fb_story_photo" : { error: "A Facebook Story needs a picture or a video." };
    return m.images > 1 ? "fb_photos" : m.images === 1 ? "fb_photo" : "fb_text";
  }
  return { error: "Placements apply to Instagram and Facebook only." };
}

export const SURFACE_LABEL: Record<Surface, string> = {
  ig_reel: "Instagram Reel",
  ig_story_video: "Instagram Story",
  ig_story_image: "Instagram Story",
  ig_image: "Instagram post",
  ig_carousel: "Instagram carousel",
  fb_reel: "Facebook Reel",
  fb_video: "Facebook video",
  fb_story_video: "Facebook Story",
  fb_story_photo: "Facebook Story",
  fb_photo: "Facebook photo post",
  fb_photos: "Facebook multi-photo post",
  fb_text: "Facebook post",
};
