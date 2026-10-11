import type { Format, Pillar, Post, RevenueEstimate, Settings } from "./types";
import { offerFor } from "./compose";
import { clamp } from "./utils";

/**
 * Relative advertiser demand by pillar (0–1). Finance and B2B software consistently
 * command the highest ad rates across platforms; exact CPMs vary by platform, country,
 * season and audience. These are relative weights, not dollar figures.
 */
export const PILLAR_DEMAND: Record<Pillar, number> = {
  wealth_systems: 1.0,
  ai_leverage: 0.9,
  longevity: 0.7,
  high_agency: 0.65,
  relationships: 0.55,
};

const FORMAT_REACH: Record<Format, number> = {
  short: 1.0,
  thread: 1.25,
  carousel: 1.35,
  video_script: 1.5,
  caption: 1.0,
};

/**
 * Money score 0–100: how well this post is built to earn, based on things we can actually
 * check (topic demand, hook quality, CTA, offer fit, format). It is a heuristic, not a forecast.
 */
export function scorePost(post: Post, settings: Settings): { score: number; notes: string[]; revenue: RevenueEstimate } {
  const notes: string[] = [];
  let score = PILLAR_DEMAND[post.pillar] * 35;
  notes.push(`Topic demand ${Math.round(PILLAR_DEMAND[post.pillar] * 100)}/100 (${post.pillar.replace("_", " ")})`);

  const hook = post.hook.trim();
  let hookPts = 0;
  if (/\d/.test(hook)) hookPts += 5;
  if (hook.length >= 25 && hook.length <= 120) hookPts += 5;
  if (/\b(you|your)\b/i.test(hook)) hookPts += 3;
  if (/\b(why|how|stop|most|nobody|mistake|actually|wrong|truth|cost)\b/i.test(hook)) hookPts += 5;
  if (/\?$/.test(hook)) hookPts += 2;
  score += Math.min(hookPts, 18);
  notes.push(hookPts >= 12 ? "Strong hook" : hookPts >= 6 ? "Decent hook" : "Weak hook — add tension or a number");

  if (post.cta?.trim()) {
    score += 10;
    notes.push("Has a call to action");
  } else notes.push("No CTA — add a save/follow/reply prompt");

  const offer = offerFor(post, settings);
  if (offer) {
    const fit = offer.pillar === "any" || offer.pillar === post.pillar;
    score += fit ? 20 : 8;
    notes.push(fit ? `Offer matched: ${offer.name}` : `Offer attached (weak topic fit): ${offer.name}`);
  } else if (settings.offers.length) {
    notes.push("No offer attached — try “Maximize money”");
  } else {
    notes.push("Add affiliate offers in Settings to monetize directly");
  }

  score += (FORMAT_REACH[post.format] - 1) * 20 + 7;
  if (post.safetyFlags.some((f) => f.startsWith("block:"))) {
    score -= 40;
    notes.push("Safety block — will not auto-publish");
  }

  return { score: Math.round(clamp(score, 0, 100)), notes, revenue: estimateRevenue(post, settings) };
}

/**
 * Revenue estimate from YOUR inputs (Settings → Revenue model):
 *   views  = followers × reach rate × format multiplier (range ±40%)
 *   ads    = views / 1000 × your RPM × topic demand
 *   affiliate = views × CTR × conversion × commission (only if an offer is attached)
 * Treat as an order-of-magnitude planning number.
 */
export function estimateRevenue(post: Post, settings: Settings): RevenueEstimate {
  const a = settings.audience[post.platform];
  const views = a.followers * a.reachRate * FORMAT_REACH[post.format];
  const ads = (views / 1000) * settings.rpmUsd * PILLAR_DEMAND[post.pillar];
  const offer = offerFor(post, settings);
  const aff = offer ? views * settings.affiliateCtr * settings.affiliateConversion * offer.commissionUsd : 0;
  const mid = ads + aff;
  return {
    low: Math.round(mid * 0.6 * 100) / 100,
    high: Math.round(mid * 1.4 * 100) / 100,
    basis: `~${Math.round(views).toLocaleString()} views × $${settings.rpmUsd} RPM${offer ? ` + affiliate (${offer.name})` : ""}`,
  };
}
