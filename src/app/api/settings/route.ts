import { body, fail, authed, ok } from "@/lib/http-api";
import { getSettings, log, saveSettings } from "@/lib/repo";
import { isValidTimeZone } from "@/lib/time";
import type { Settings } from "@/lib/types";
import { clamp, uid } from "@/lib/utils";
import { ABSOLUTE_MAX_POSTS_PER_DAY, planById } from "@/lib/plans";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = authed(async () => ok(await getSettings()));

export const PUT = authed(async (req, user) => {
  const patch = await body<Partial<Settings>>(req);
  const before = await getSettings();

  if (patch.timezone && !isValidTimeZone(patch.timezone)) return fail("Unknown timezone (use an IANA name like America/Chicago).");
  const plan = planById(user.plan);
  const maxPerDay = plan.maxPostsPerDay ?? ABSOLUTE_MAX_POSTS_PER_DAY;
  if (patch.postsPerDay != null) {
    if (patch.postsPerDay > maxPerDay) return fail(plan.maxPostsPerDay === null ? `For account safety, the most is ${ABSOLUTE_MAX_POSTS_PER_DAY} posts per day per platform.` : `${plan.name} allows up to ${maxPerDay} posts a day per platform. Upgrade for more.`, 402);
    patch.postsPerDay = clamp(Math.round(patch.postsPerDay), 1, maxPerDay);
  }
  if (patch.limits) {
    for (const p of PLATFORMS) if (patch.limits[p]) patch.limits[p].postsPerDay = clamp(Math.round(patch.limits[p].postsPerDay), 0, maxPerDay);
  }
  if (patch.platforms) {
    const on = PLATFORMS.filter((p) => patch.platforms![p]).length;
    const wasOn = PLATFORMS.filter((p) => before.platforms[p]).length;
    // Over the limit only blocks turning more on, so an account above it (e.g. after a downgrade) can always switch platforms off.
    if (on > plan.maxPlatforms && on > wasOn) return fail(`${plan.name} includes ${plan.maxPlatforms} platform${plan.maxPlatforms > 1 ? "s" : ""}. Turn one off or upgrade.`, 402);
  }
  if (patch.autoReply && !plan.features.autoReplies) return fail(`Automatic replies are included from Pro. You can still draft replies by hand on the Engagement page.`, 402);

  if (patch.offers) {
    patch.offers = patch.offers
      .filter((o) => o.name?.trim() && /^https:\/\//.test(o.url ?? ""))
      .map((o) => ({ ...o, id: o.id || uid("offer"), commissionUsd: Math.max(0, Number(o.commissionUsd) || 0) }));
  }
  if (patch.slots) {
    for (const k of Object.keys(patch.slots) as (keyof Settings["slots"])[]) {
      patch.slots[k] = (patch.slots[k] ?? []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort();
    }
  }

  const next = await saveSettings(patch);
  if (patch.killSwitch !== undefined && patch.killSwitch !== before.killSwitch) {
    await log(patch.killSwitch ? "warn" : "info", "system", patch.killSwitch ? "KILL SWITCH ENGAGED — all posting and replying stopped" : "Kill switch released");
  }
  if (patch.autopilot !== undefined && patch.autopilot !== before.autopilot) {
    await log("info", "system", `Autopilot ${patch.autopilot ? "ON" : "OFF"}`);
  }
  if (patch.matureX !== undefined && patch.matureX !== before.matureX) {
    await log("warn", "safety", `Mature (18+) mode for X ${patch.matureX ? "ON — posts stay non-explicit and need manual publishing" : "OFF"}`, { platform: "x" });
  }
  if (patch.autoReply !== undefined && patch.autoReply !== before.autoReply) {
    await log("info", "system", `Auto-engagement ${patch.autoReply ? "ON" : "OFF"}`);
  }
  return ok(next);
});
