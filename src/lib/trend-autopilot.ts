import "server-only";
import { QuotaError, spendCredits, type User } from "./auth";
import { withCredits } from "./credits";
import { generatePosts } from "./generate";
import { generateVideoPosts } from "./video";
import { GENRES, genreById } from "./genres";
import { findStory, getTrends, type TrendStory } from "./trends";
import { CREDIT_COST } from "./plans";
import { lengthAllowed, videoCredits } from "./video-spec";
import { credentialStatuses, getSettings, kvGet, kvSet, listPosts, log, savePosts } from "./repo";
import { enabledPlatforms, slotsFor } from "./scheduler";
import { addDays, localParts, toMinutes, zonedToUtc } from "./time";
import { enqueueRender, ffmpegAvailable } from "./render";
import type { Platform, Post, Settings, VideoPlan } from "./types";
import { nowIso } from "./utils";

/**
 * Trend Autopilot. Every couple of hours it reads the live stories in the account's genres and fills the open
 * posting slots of the next few hours with fresh pieces built from them, so what goes out is about what's
 * happening now. Text platforms get posts; video platforms get a video plan (rendered to MP4 if chosen).
 * Credits are charged like any generation (free during a trial's daily allowance, nothing on the user's own AI).
 */

const STATE = "trend_autopilot_state";
const RUN_EVERY_MS = 2 * 3600_000;
/** Only slots this close are filled, so news is at most a few hours old when it posts. */
const WINDOW_MS = 6 * 3600_000;
const TEXT_PLATFORMS: Platform[] = ["x", "facebook", "linkedin", "webhook"];
const VIDEO_PLATFORMS: Platform[] = ["tiktok", "youtube", "instagram", "facebook"];

export interface AutopilotState {
  lastRunAt?: string;
  lastResult?: string;
  /** Stories already used, so the same event isn't posted twice. */
  used: string[];
}

export const getAutopilotState = async () => (await kvGet<AutopilotState>(STATE)) ?? { used: [] };

/** Open slots for a platform from now until `windowMs` ahead, as UTC dates. */
export function openSlots(platform: Platform, s: Settings, existing: Post[], windowMs = WINDOW_MS, now = Date.now()) {
  const today = localParts(new Date(now), s.timezone).date;
  const out: Date[] = [];
  for (const date of [today, addDays(today, 1)]) {
    const taken = existing
      .filter((p) => p.platform === platform && p.scheduledAt)
      .map((p) => localParts(new Date(p.scheduledAt!), s.timezone))
      .filter((lp) => lp.date === date)
      .map((lp) => lp.minutes);
    for (const slot of slotsFor(platform, s)) {
      const at = zonedToUtc(date, slot, s.timezone);
      const t = at.getTime();
      if (t > now + 10 * 60_000 && t <= now + windowMs && !taken.some((m) => Math.abs(m - toMinutes(slot)) < 45)) out.push(at);
    }
  }
  return out;
}

/** Picks the hottest unused story, rotating through the account's genres. Evergreen genres yield null (genre-only piece). */
function picker(pools: Map<string, TrendStory[]>, genres: string[], used: Set<string>) {
  let turn = 0;
  return () => {
    for (let i = 0; i < genres.length; i++) {
      const genre = genres[(turn + i) % genres.length];
      const pool = pools.get(genre) ?? [];
      const story = pool.find((st) => !used.has(st.id));
      if (story || !genreById(genre)?.feeds.length) {
        turn = (turn + i + 1) % genres.length;
        if (story) used.add(story.id);
        return { genre, story: story ?? null };
      }
    }
    return null;
  };
}

/** One run for the signed-in account. `force` runs it now even if it ran recently (the "Run now" button). */
export async function runTrendAutopilot(user: User, opts: { force?: boolean } = {}) {
  const s = await getSettings();
  const ta = s.trendAutopilot;
  if (!ta.enabled && !opts.force) return { ran: false, reason: "Trend Autopilot is off" };
  if (s.killSwitch) return { ran: false, reason: "Kill switch is on" };
  const state = await getAutopilotState();
  if (!opts.force && state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) < RUN_EVERY_MS) return { ran: false, reason: "Ran recently" };

  const genres = s.genres.filter((g) => genreById(g)).length ? s.genres.filter((g) => genreById(g)) : ["trending"];
  const pools = new Map<string, TrendStory[]>();
  await Promise.all(genres.map(async (g) => pools.set(g, (await getTrends(g).catch(() => ({ stories: [] }))).stories)));
  const used = new Set(state.used);
  const next = picker(pools, genres, used);

  const linked = new Set((await credentialStatuses()).filter((c) => c.connected).map((c) => c.platform));
  const on = enabledPlatforms(s);
  const existing = (await listPosts()).filter((p) => p.scheduledAt && ["scheduled", "pending_review", "published", "copy_ready", "publishing"].includes(p.status));
  const status: Post["status"] = ta.mode === "drafts" ? "draft" : user.requireApproval ? "pending_review" : "scheduled";

  const created: Post[] = [];
  const notes: string[] = [];
  let outOfCredits = false;

  const plan = async (platform: Platform, kind: "text" | "video", count: number) => {
    const slots = ta.mode === "schedule" ? openSlots(platform, s, existing).slice(0, count) : [];
    const n = ta.mode === "schedule" ? slots.length : count;
    for (let i = 0; i < n && !outOfCredits; i++) {
      const pick = next();
      if (!pick) break;
      try {
        const length: VideoPlan["length"] = lengthAllowed(ta.videoLength, platform) ? ta.videoLength : "s90";
        const ctx = { genre: pick.genre, stories: pick.story ? [pick.story] : undefined };
        const check = pick.story ? CREDIT_COST.liveCheck : 0;
        const posts =
          kind === "text"
            ? await withCredits(CREDIT_COST.post + check, () => generatePosts({ platform, count: 1, ...ctx }, s), user.id)
            : await withCredits(videoCredits(length, "plan") + check, () => generateVideoPosts({ platform, count: 1, niche: "auto", style: genreById(pick.genre)?.style ?? "true", length, ...ctx }, s), user.id);
        for (const p of posts) {
          p.source = "trend-autopilot";
          p.status = status;
          if (slots[i]) p.scheduledAt = slots[i].toISOString();
        }
        created.push(...posts);
        existing.push(...posts.filter((p) => p.scheduledAt)); // so the next batch doesn't take the same slot
      } catch (e) {
        if (e instanceof QuotaError) {
          outOfCredits = true;
          notes.push(e.message);
        } else notes.push(`${platform}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  };

  for (const platform of on) {
    // In schedule mode only post where the account is actually linked, so nothing fails at publish time.
    if (ta.mode === "schedule" && !linked.has(platform)) continue;
    if (TEXT_PLATFORMS.includes(platform)) await plan(platform, "text", ta.mode === "schedule" ? 6 : 1);
    if (ta.videos && VIDEO_PLATFORMS.includes(platform)) await plan(platform, "video", 1);
  }

  if (created.length) await savePosts(created);

  // Optional: render the new video plans into MP4s.
  let rendering = 0;
  if (ta.autoRender && (await ffmpegAvailable())) {
    for (const p of created.filter((x) => x.kind === "video" && x.video)) {
      const credits = videoCredits(p.video!.length, "render");
      try {
        await spendCredits(user.id, credits);
        p.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
        await savePosts([p]);
        enqueueRender(user.id, p.id, credits);
        rendering++;
      } catch (e) {
        notes.push((e as Error).message);
        break;
      }
    }
  }

  if (ta.mode === "schedule" && !on.some((p) => linked.has(p))) notes.push("No linked platform is switched on: link one on the Platforms tab, or switch Trend Autopilot to drafts.");
  const summary = created.length
    ? `Trend Autopilot wrote ${created.length} piece${created.length > 1 ? "s" : ""} from live news${rendering ? `, rendering ${rendering} video${rendering > 1 ? "s" : ""}` : ""}`
    : "Trend Autopilot found no open slots to fill right now";
  await kvSet<AutopilotState>(STATE, { lastRunAt: nowIso(), lastResult: notes.length ? `${summary}. ${notes.slice(0, 3).join(" · ")}` : summary, used: [...used].slice(-400) });
  await log(notes.length ? "warn" : "info", "generate", summary, { notes, genres });
  return { ran: true, created: created.length, rendering, notes };
}

/** Writes one post or video from a chosen live story (Trend Radar buttons). */
export async function createFromStory(
  input: { genre: string; storyId?: string; platform: Platform; kind: "text" | "video"; length?: VideoPlan["length"]; faceless?: boolean },
  userId: string,
) {
  const s = await getSettings();
  const genre = genreById(input.genre) ? input.genre : GENRES[0].id;
  const story = input.storyId ? await findStory(genre, input.storyId) : null;
  if (input.storyId && !story) throw new Error("That story has rotated out of the feed. Refresh the list and pick it again.");
  const ctx = { genre, stories: story ? [story] : undefined };
  const check = story ? CREDIT_COST.liveCheck : 0;
  if (input.kind === "video") {
    const length: VideoPlan["length"] = input.length && lengthAllowed(input.length, input.platform) ? input.length : "s90";
    const posts = await withCredits(videoCredits(length, "plan") + check, () =>
      generateVideoPosts({ platform: input.platform, count: 1, niche: "auto", style: genreById(genre)?.style ?? "true", length, faceless: input.faceless, ...ctx }, s),
    userId);
    await savePosts(posts);
    return posts;
  }
  const posts = await withCredits(CREDIT_COST.post + check, () => generatePosts({ platform: input.platform, count: 1, ...ctx }, s), userId);
  await savePosts(posts);
  return posts;
}
