import "server-only";
import { claudeJson } from "./llm";
import { MODE_BRIEF, PERSONALITY_LOCK } from "./personality";
import { ADAPTERS } from "./platforms/adapters";
import { freshCredential } from "./platforms/auth";
import { AuthError, CopyReadyError, RateLimitError } from "./platforms/http";
import { PLATFORM_SPECS } from "./platforms/specs";
import { canAct, clearStrikes, coolDown, jitterMs, recordAction } from "./ratelimit";
import { getSettings, listComments, listPosts, listReplies, log, saveComments, saveReply } from "./repo";
import { checkOutput, classifyComment } from "./safety";
import { renderPost } from "./compose";
import type { Platform, Post, Reply, ReplyMode, Settings, SocialComment } from "./types";
import { PLATFORMS, REPLY_MODES } from "./types";
import { nowIso, similarity, sleep, uid } from "./utils";
import { QuotaError, refundCredits, spendCredits } from "./auth";
import { currentUserId } from "./db";
import { CREDIT_COST } from "./plans";

const replyLimit = (p: Platform) => (p === "x" ? 280 : 450);

/** Higher = answer first. Reach of the commenter, real questions and substance rank up. */
export function priorityOf(text: string, followers?: number) {
  let s = 10;
  if (followers) s += Math.min(40, Math.log10(followers + 1) * 10);
  if (/\?/.test(text)) s += 15;
  s += Math.min(15, text.length / 25);
  if (/\b(how|why|what|which|recommend|struggl|advice|tool|start)\b/i.test(text)) s += 8;
  return Math.round(s);
}

interface GenItem {
  id: string;
  author: string;
  text: string;
  flags: string[];
  mode: ReplyMode;
}

async function generateReplies(platform: Platform, postText: string, items: GenItem[], s: Settings) {
  const limit = replyLimit(platform);
  const user = `You are replying, as the creator, to comments on your ${PLATFORM_SPECS[platform].name} post.

YOUR POST:
"""${postText.slice(0, 2500)}"""

COMMENTS (JSON):
${JSON.stringify(items.map((i) => ({ id: i.id, author: i.author, text: i.text.slice(0, 800), flags: i.flags, mode: i.mode })))}

REPLY MODES:
${Object.entries(MODE_BRIEF).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
- auto: choose the best-fitting mode yourself.

RULES
- Max ${limit} characters each. Reference something specific they said.
- Never open with "Great point", "Thanks for sharing", "Love this", "Absolutely" or similar filler.
- No hashtags, no links, at most one emoji, no sales pitch.
- flags include "asks_personal_advice": give general education and suggest a qualified professional for their specific situation. No personalized financial, medical or legal instructions.
- flags include "hostile_tone": stay gracious; if there's a legitimate point, answer it with substance; if not, return "" (skip). Never argue.
- Never claim to be human or deny being AI-assisted. If someone sincerely asks, be honest.
- If no reply would add value, return "" for that id.

Return JSON only: {"replies":[{"id":"…","mode":"value_add","text":"…"}]}`;

  const res = await claudeJson<{ replies: { id: string; mode?: string; text: string }[] }>({
    system: PERSONALITY_LOCK + (s.brandVoiceNotes ? `\n\nCREATOR NOTES: ${s.brandVoiceNotes}` : ""),
    user,
    maxTokens: 300 * items.length + 400,
    temperature: 0.8,
  });
  return res.replies ?? [];
}

function finalizeReply(r: Reply, recentSent: string[], s: Settings) {
  const check = checkOutput(r.text, r.platform, { allowedUrls: [], perPartLimit: replyLimit(r.platform) });
  const flags = new Set([...r.safetyFlags.filter((f) => !f.startsWith("block:") && !f.startsWith("warn:")), ...check.flags]);
  if (recentSent.some((t) => similarity(t, r.text) > 0.6)) flags.add("warn:repetitive");
  r.safetyFlags = [...flags];
  if (!check.ok) r.status = "blocked";
  else r.status = s.requireReplyApproval || !s.autoReply ? "pending_approval" : "approved";
  return r;
}

function postContext(posts: Post[], platform: Platform, externalId: string, s: Settings) {
  const post = posts.find((p) => p.platform === platform && (p.externalId === externalId || p.externalIds?.includes(externalId)));
  return { post, text: post ? renderPost(post, s).join("\n") : "(post text unavailable — reply to the comment on its own merits)" };
}

/** Fetch new comments, triage them, draft replies. Then send anything approved. */
export async function runEngage(opts: { manual?: boolean } = {}) {
  const s = await getSettings();
  if (s.killSwitch) return { ran: false, reason: "Kill switch on" };
  const summary: Record<string, unknown> = {};

  if (s.autoReply || opts.manual) {
    const posts = await listPosts();
    const known = new Set((await listComments()).map((c) => c.id));
    const replies = await listReplies();
    const recentSent = replies.filter((r) => r.status === "sent").slice(0, 100).map((r) => r.text);

    for (const platform of PLATFORMS) {
      const adapter = ADAPTERS[platform];
      if (!s.platforms[platform] || !adapter.engageable) continue;
      const cred = await freshCredential(platform);
      if (!cred) continue;

      const ids = posts
        .filter((p) => p.platform === platform && p.status === "published" && p.externalId && Date.now() - new Date(p.publishedAt ?? 0).getTime() < 7 * 86400_000)
        .slice(0, 15)
        .map((p) => p.externalId!);
      if (!ids.length && platform !== "youtube") continue;

      let raw;
      try {
        raw = await adapter.fetchComments(cred, ids);
        await clearStrikes(platform);
      } catch (e) {
        if (e instanceof RateLimitError) await coolDown(platform, e.retryAfterSec);
        if (!(e instanceof CopyReadyError)) await log("warn", "engage", `Could not fetch ${platform} comments: ${(e as Error).message}`, { platform });
        continue;
      }

      const fresh: SocialComment[] = raw
        .map((c) => ({
          id: `${platform}:${c.externalId}`,
          platform,
          postExternalId: c.postExternalId,
          externalId: c.externalId,
          author: c.author,
          authorFollowers: c.authorFollowers,
          text: c.text,
          createdAt: c.createdAt,
          priority: priorityOf(c.text, c.authorFollowers),
          handled: false,
        }))
        .filter((c) => !known.has(c.id));
      if (!fresh.length) continue;

      const toDraft: (SocialComment & { flags: string[] })[] = [];
      let skipped = 0;
      for (const c of fresh) {
        const verdict = classifyComment(c.text);
        if (verdict.action === "skip") {
          c.handled = true;
          skipped++;
        } else if (verdict.action === "escalate") {
          c.handled = true;
          const { post } = postContext(posts, platform, c.postExternalId, s);
          await saveReply({
            id: uid("rep"), commentId: c.id, platform, postId: post?.id, postExternalId: c.postExternalId, commentExternalId: c.externalId,
            author: c.author, commentText: c.text, mode: "supportive", text: "", status: "escalated", priority: 100,
            safetyFlags: verdict.flags, createdAt: nowIso(), updatedAt: nowIso(),
          });
          await log("warn", "safety", `Comment escalated for human review (${verdict.flags.join(", ")})`, { platform, author: c.author });
        } else toDraft.push({ ...c, flags: verdict.flags });
      }
      await saveComments(fresh);
      if (skipped) await log("info", "safety", `Skipped ${skipped} spam/abusive/low-signal comments`, { platform });

      toDraft.sort((a, b) => b.priority - a.priority);
      const batch = toDraft.slice(0, 20);
      // Group by post so each LLM call has the right context.
      const byPost = new Map<string, typeof batch>();
      batch.forEach((c) => byPost.set(c.postExternalId, [...(byPost.get(c.postExternalId) ?? []), c]));

      let drafted = 0;
      for (const [postExtId, comments] of byPost) {
        const { post, text } = postContext(posts, platform, postExtId, s);
        for (let i = 0; i < comments.length; i += 10) {
          const chunk = comments.slice(i, i + 10);
          const uidNow = currentUserId();
          try {
            if (uidNow) await spendCredits(uidNow, CREDIT_COST.replies);
          } catch (e) {
            if (e instanceof QuotaError) {
              await log("warn", "engage", `Reply drafting paused: ${e.message}`, { platform });
              break;
            }
            throw e;
          }
          try {
            const gen = await generateReplies(platform, text, chunk.map((c) => ({ id: c.id, author: c.author, text: c.text, flags: c.flags, mode: s.defaultReplyMode })), s);
            for (const c of chunk) {
              const g = gen.find((x) => x.id === c.id);
              const mode = (REPLY_MODES as readonly string[]).includes(g?.mode ?? "") ? (g!.mode as ReplyMode) : s.defaultReplyMode;
              const reply: Reply = {
                id: uid("rep"), commentId: c.id, platform, postId: post?.id, postExternalId: postExtId, commentExternalId: c.externalId,
                author: c.author, commentText: c.text, mode, text: (g?.text ?? "").trim(), status: "pending_approval", priority: c.priority,
                safetyFlags: c.flags, createdAt: nowIso(), updatedAt: nowIso(),
              };
              if (!reply.text) reply.status = "skipped";
              else finalizeReply(reply, recentSent, s);
              await saveReply(reply);
              drafted++;
            }
          } catch (e) {
            if (uidNow) await refundCredits(uidNow, CREDIT_COST.replies);
            await log("error", "engage", `Reply drafting failed: ${(e as Error).message}`, { platform });
          }
        }
      }
      await saveComments(fresh.map((c) => ({ ...c, handled: true })));
      summary[platform] = { newComments: fresh.length, drafted, skipped };
      await log("info", "engage", `${PLATFORM_SPECS[platform].name}: ${fresh.length} new comments, ${drafted} replies drafted`, { platform });
    }
  }

  summary.sent = await sendApproved(s, opts.manual ? 10 : 5);
  return { ran: true, summary };
}

/** Sends approved replies, highest priority first, inside rate limits with human-like spacing. */
export async function sendApproved(s?: Settings, maxPerPlatform = 5) {
  const settings = s ?? (await getSettings());
  if (settings.killSwitch) return 0;
  const queue = (await listReplies()).filter((r) => r.status === "approved").sort((a, b) => b.priority - a.priority);
  const sentPer: Partial<Record<Platform, number>> = {};
  const blocked = new Set<Platform>();
  let sent = 0;
  const started = Date.now();
  const BUDGET_MS = 240_000; // stay inside a 300s serverless function limit

  for (const r of queue) {
    if (blocked.has(r.platform) || (sentPer[r.platform] ?? 0) >= maxPerPlatform) continue;
    let gate = await canAct(r.platform, "reply", settings);
    if (!gate.ok && /Minimum gap/.test(gate.reason ?? "")) {
      const wait = settings.limits[r.platform].minGapSec * 1000 + jitterMs(1, 6);
      if (Date.now() - started + wait < BUDGET_MS) {
        await sleep(wait);
        gate = await canAct(r.platform, "reply", settings);
      }
    }
    if (!gate.ok) {
      blocked.add(r.platform);
      continue;
    }
    const cred = await freshCredential(r.platform);
    if (!cred) {
      blocked.add(r.platform);
      continue;
    }
    r.status = "sending";
    await saveReply(r);
    try {
      r.externalId = await ADAPTERS[r.platform].reply(cred, { commentExternalId: r.commentExternalId, postExternalId: r.postExternalId }, r.text);
      r.status = "sent";
      r.sentAt = nowIso();
      r.error = undefined;
      await recordAction(r.platform, "reply");
      await log("info", "reply", `Replied to ${r.author}: “${r.text.slice(0, 100)}”`, { platform: r.platform, replyId: r.id, comment: r.commentText });
      sent++;
      sentPer[r.platform] = (sentPer[r.platform] ?? 0) + 1;
    } catch (e) {
      const err = e as Error;
      if (err instanceof RateLimitError) {
        await coolDown(r.platform, err.retryAfterSec);
        r.status = "approved";
        blocked.add(r.platform);
      } else {
        r.status = "failed";
        if (err instanceof AuthError) blocked.add(r.platform);
      }
      r.error = err.message.slice(0, 300);
      await log(r.status === "failed" ? "error" : "warn", "reply", `Reply not sent: ${r.error}`, { platform: r.platform, replyId: r.id });
    }
    await saveReply(r);
    await sleep(jitterMs(3, 9));
  }
  return sent;
}

/** Re-draft one reply in a chosen mode. */
export async function regenerateReply(r: Reply, mode: ReplyMode) {
  const s = await getSettings();
  const posts = await listPosts();
  const { text } = postContext(posts, r.platform, r.postExternalId, s);
  const verdict = classifyComment(r.commentText);
  const [g] = await generateReplies(r.platform, text, [{ id: r.id, author: r.author, text: r.commentText, flags: verdict.flags, mode }], s);
  r.mode = mode;
  r.text = (g?.text ?? "").trim();
  r.safetyFlags = verdict.flags;
  const recentSent = (await listReplies()).filter((x) => x.status === "sent").slice(0, 100).map((x) => x.text);
  if (!r.text) r.status = "skipped";
  else {
    finalizeReply(r, recentSent, s);
    if (r.status === "approved") r.status = "pending_approval"; // manual regenerations always go back to review
  }
  await saveReply(r);
  return r;
}

export { finalizeReply };
