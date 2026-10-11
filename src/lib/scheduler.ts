import "server-only";
import { claudeJson } from "./llm";
import { PERSONALITY_LOCK } from "./personality";
import { generatePosts } from "./generate";
import { listPosts, log, savePosts, saveSettings } from "./repo";
import { localParts, toMinutes, zonedToUtc } from "./time";
import type { Platform, Post, Settings } from "./types";
import { PLATFORMS } from "./types";
import { PLATFORM_SPECS } from "./platforms/specs";

export const enabledPlatforms = (s: Settings) => PLATFORMS.filter((p) => s.platforms[p]);

/**
 * The day's posting times for a platform. Uses the saved slots first; when posts/day is higher than the
 * number of saved slots (Unlimited plan), the rest are spread evenly between 07:00 and 22:30.
 */
export function slotsFor(platform: Platform, s: Settings) {
  const n = Math.max(1, s.postsPerDay);
  const saved = [...(s.slots[platform] ?? [])].sort();
  if (saved.length >= n) return saved.slice(0, n);
  const start = 7 * 60, end = 22 * 60 + 30;
  const extra: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = Math.round(start + ((end - start) * i) / Math.max(1, n - 1));
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    // keep at least 30 minutes away from any saved slot
    if (!saved.some((x) => Math.abs(toMinutes(x) - m) < 30)) extra.push(t);
  }
  return [...saved, ...extra].sort().slice(0, n);
}

/**
 * Fills one local calendar day with posts for each platform, only in free future slots.
 * Called once per day by the "Fill my week" flow so each request stays short.
 */
export async function fillDay(date: string, platforms: Platform[], s: Settings, topic?: string, status: "scheduled" | "pending_review" = "scheduled") {
  const existing = (await listPosts()).filter((p) => p.scheduledAt && ["scheduled", "pending_review", "published", "copy_ready", "publishing"].includes(p.status));
  const now = Date.now();
  const created: Post[] = [];
  const errors: string[] = [];

  await Promise.all(
    platforms.map(async (platform) => {
      const taken = existing
        .filter((p) => p.platform === platform)
        .map((p) => localParts(new Date(p.scheduledAt!), s.timezone))
        .filter((lp) => lp.date === date)
        .map((lp) => lp.minutes);
      const free = slotsFor(platform, s).filter((slot) => {
        const at = zonedToUtc(date, slot, s.timezone).getTime();
        return at > now + 5 * 60_000 && !taken.some((m) => Math.abs(m - toMinutes(slot)) < 45);
      });
      if (!free.length) return;
      try {
        const posts = await generatePosts({ platform, count: free.length, topic }, s);
        posts.forEach((p, i) => {
          p.scheduledAt = zonedToUtc(date, free[i], s.timezone).toISOString();
          p.status = status;
        });
        created.push(...posts);
      } catch (e) {
        errors.push(`${PLATFORM_SPECS[platform].name}: ${(e as Error).message}`);
      }
    }),
  );

  if (created.length) await savePosts(created);
  await log(errors.length ? "warn" : "info", "schedule", `Filled ${date}: ${created.length} posts scheduled${errors.length ? `, ${errors.length} errors` : ""}`, {
    date,
    errors,
  });
  return { created, errors };
}

/** AI-generated posting windows per platform, saved to Settings → slots. */
export async function planSlots(s: Settings, notes?: string) {
  const platforms = enabledPlatforms(s);
  const user = `Design a weekly posting-time plan for a creator in the Modern Wealth, Mind & Relationships niche.
Timezone of the audience: ${s.timezone}. Posts per day per platform: ${s.postsPerDay}.
Platforms: ${platforms.map((p) => PLATFORM_SPECS[p].name).join(", ")}.
${notes ? `Creator notes about the audience: ${notes}` : ""}

Use widely reported engagement patterns (commute, lunch, evening wind-down; weekday vs weekend behaviour for professional platforms) and spread slots at least 2.5 hours apart. Be honest that these are starting points.
Return JSON only: {"slots":{"x":["08:30","12:15","18:45"]},"rationale":"2-3 sentences"}  — keys only for: ${platforms.join(", ")}. Times as HH:MM 24h local.`;

  const res = await claudeJson<{ slots: Partial<Record<Platform, string[]>>; rationale?: string }>({
    system: PERSONALITY_LOCK,
    user,
    maxTokens: 800,
    temperature: 0.4,
  });
  const slots = { ...s.slots };
  for (const p of platforms) {
    const v = (res.slots?.[p] ?? []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
    if (v.length) slots[p] = v.slice(0, 6).sort();
  }
  const next = await saveSettings({ slots });
  await log("info", "schedule", "AI posting plan applied", { slots, rationale: res.rationale });
  return { settings: next, rationale: res.rationale ?? "" };
}
