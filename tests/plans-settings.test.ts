import { describe, expect, it } from "vitest";
import { CREDIT_COST, DEFAULT_PREMIUM_MODEL, PLANS, planById, storyCredits } from "@/lib/plans";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/defaults";
import { PLATFORMS } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";

describe("plans", () => {
  it("Pro and Unlimited use the strongest model for long scripts; Free and Creator do not", () => {
    expect(planById("pro").features.priorityModel).toBe(true);
    expect(planById("unlimited").features.priorityModel).toBe(true);
    expect(planById("free").features.priorityModel).toBe(false);
    expect(planById("creator").features.priorityModel).toBe(false);
    expect(DEFAULT_PREMIUM_MODEL).toMatch(/^claude-/);
  });

  it("charges double credits for long scripts on the strongest model, and the server and UI agree", () => {
    expect(storyCredits(planById("pro"), true)).toBe(CREDIT_COST.storyLong * 2);
    expect(storyCredits(planById("creator"), true)).toBe(CREDIT_COST.storyLong);
    expect(storyCredits(planById("pro"), false)).toBe(CREDIT_COST.storyShort);
  });

  it("every plan can afford at least one long script it is allowed to write", () => {
    for (const p of PLANS.filter((x) => x.features.longStories)) expect(p.credits).toBeGreaterThanOrEqual(storyCredits(p, true));
  });

  it("platform caps allow every platform on the top plans", () => {
    expect(planById("pro").maxPlatforms).toBe(PLATFORMS.length);
    expect(planById("unlimited").maxPlatforms).toBe(PLATFORMS.length);
  });
});

describe("settings", () => {
  it("every platform has defaults and a spec", () => {
    for (const p of PLATFORMS) {
      expect(DEFAULT_SETTINGS.slots[p]?.length, `slots ${p}`).toBeGreaterThan(0);
      expect(DEFAULT_SETTINGS.limits[p], `limits ${p}`).toBeTruthy();
      expect(DEFAULT_SETTINGS.audience[p], `audience ${p}`).toBeTruthy();
      expect(PLATFORM_SPECS[p], `spec ${p}`).toBeTruthy();
    }
  });

  it("existing accounts saved before the webhook connector get safe defaults (off)", () => {
    const old = { platforms: { x: true, facebook: false, linkedin: true, instagram: true, youtube: false, tiktok: true }, platformsV2: true } as never;
    const merged = mergeSettings(old);
    expect(merged.platforms.webhook).toBe(false);
    expect(merged.limits.webhook.postsPerDay).toBeGreaterThan(0);
    expect(merged.audience.webhook).toBeTruthy();
  });
});
