import { authed, ok } from "@/lib/http-api";
import { credentialStatuses, getSettings, listLogs, listPosts, listReplies } from "@/lib/repo";
import { llmConfigured } from "@/lib/llm";
import { stripeReady } from "@/lib/billing";
import { getLlmHealth } from "@/lib/llm-health";
import { storageMode } from "@/lib/db";
import { localParts } from "@/lib/time";
import { kvGet } from "@/lib/repo";
import { publicUser, trialActive, trialEligible, trialFreeLeft } from "@/lib/auth";
import { ownAiStatus } from "@/lib/ai-provider";
import { TRIAL_DAILY_FREE_CREDITS } from "@/lib/plans";
import { planById } from "@/lib/plans";
import { getMetricool, metricoolStatus } from "@/lib/metricool";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, user) => {
  const [settings, posts, replies, logs, creds, cooldowns] = await Promise.all([
    getSettings(),
    listPosts(),
    listReplies(),
    listLogs(15),
    credentialStatuses(),
    kvGet<Record<string, number>>("cooldowns"),
  ]);
  const today = localParts(new Date(), settings.timezone).date;
  const weekAhead = Date.now() + 7 * 86400_000;
  const upcoming = posts
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const weekPosts = upcoming.filter((p) => new Date(p.scheduledAt!).getTime() < weekAhead);

  // Posts handed to the person's Facebook profile, oldest first, so they can post them in order.
  const readyForYou = posts
    .filter((p) => p.status === "copy_ready" && p.handoff && !p.handoff.postedAt)
    .sort((a, b) => a.handoff!.readyAt.localeCompare(b.handoff!.readyAt))
    .map((p) => ({ id: p.id, hook: p.hook, kind: p.kind === "video" || p.videoUrl ? "video" : p.mediaIds?.length ? "media" : "text", readyAt: p.handoff!.readyAt }));
  const plan = planById(user.plan);
  const [llm, stripe, llmHealth, ownAi] = await Promise.all([llmConfigured(), stripeReady(), user.role === "admin" ? getLlmHealth() : Promise.resolve(null), ownAiStatus()]);
  return ok({
    me: {
      user: publicUser(user),
      plan,
      creditsLeft: Math.max(0, plan.credits - user.usage.credits),
      postsLeft: plan.postsPerMonth === null ? null : Math.max(0, plan.postsPerMonth - user.usage.posts),
      trial: {
        active: trialActive(user),
        endsAt: user.billing?.trialEnd ?? null,
        eligible: trialEligible(user),
        freeLeftToday: trialFreeLeft(user),
        freePerDay: TRIAL_DAILY_FREE_CREDITS,
      },
      ownAi,
    },
    settings,
    env: {
      llm,
      storage: storageMode(),
      encryption: !!process.env.ENCRYPTION_KEY,
      cron: !!process.env.CRON_SECRET || process.env.INTERNAL_SCHEDULER === "1",
      stripe,
      appUrl: !!process.env.APP_URL,
    },
    llmHealth,
    credentials: creds,
    cooldowns: cooldowns ?? {},
    stats: {
      scheduled: upcoming.length,
      publishedToday: posts.filter((p) => p.status === "published" && p.publishedAt && localParts(new Date(p.publishedAt), settings.timezone).date === today).length,
      copyReady: posts.filter((p) => p.status === "copy_ready").length,
      failed: posts.filter((p) => p.status === "failed").length,
      drafts: posts.filter((p) => p.status === "draft").length,
      inReview: posts.filter((p) => p.status === "pending_review").length,
      rejected: posts.filter((p) => p.status === "rejected").length,
      pendingReplies: replies.filter((r) => r.status === "pending_approval").length,
      escalated: replies.filter((r) => r.status === "escalated").length,
      repliesSent: replies.filter((r) => r.status === "sent").length,
      weekRevenueLow: weekPosts.reduce((s, p) => s + p.revenue.low, 0),
      weekRevenueHigh: weekPosts.reduce((s, p) => s + p.revenue.high, 0),
      avgMoneyScore: weekPosts.length ? Math.round(weekPosts.reduce((s, p) => s + p.moneyScore, 0) / weekPosts.length) : 0,
    },
    upcoming: upcoming.slice(0, 6),
    readyForYou: readyForYou.slice(0, 5),
    metricool: metricoolStatus(await getMetricool()),
    readyForYouCount: readyForYou.length,
    logs,
  });
});
