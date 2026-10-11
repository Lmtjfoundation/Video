import { authed, body, fail, ok } from "@/lib/http-api";
import { db } from "@/lib/db";
import { requireFeature, withCredits } from "@/lib/credits";
import { CREDIT_COST, planById } from "@/lib/plans";
import { writeStory, type StoryInput } from "@/lib/stories";
import { NICHES, STORY_FORMATS } from "@/lib/niches";
import { log } from "@/lib/repo";
import type { Story } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = authed(async () => ok(await db().all<Story>("stories", 200)));

export const POST = authed(async (req, user) => {
  const b = await body<StoryInput>(req);
  if (!(b.format in STORY_FORMATS)) return fail("Choose a format.");
  if (!["true", "funny", "explainer", "fiction"].includes(b.type)) return fail("Choose a story type.");
  if (b.niche === "kids") return fail("Made-for-Kids content has limited ads and comments; pick another niche.");
  if (b.niche !== "custom" && !NICHES.some((n) => n.id === b.niche)) return fail("Choose a niche.");
  const long = b.format === "long";
  if (long) requireFeature(user, "longStories", "Long story scripts");
  const premium = long && planById(user.plan).features.priorityModel && !!process.env.ANTHROPIC_PREMIUM_MODEL;
  // The strongest model costs about twice as much, so it uses twice the credits.
  const cost = long ? CREDIT_COST.storyLong * (premium ? 2 : 1) : CREDIT_COST.storyShort;
  const input: StoryInput = {
    niche: b.niche,
    customNiche: b.customNiche?.slice(0, 120),
    topic: b.topic?.slice(0, 800),
    type: b.type,
    format: b.format,
    tone: String(b.tone ?? "Gripping and suspenseful").slice(0, 60),
    voice: String(b.voice ?? "Third-person documentary").slice(0, 60),
    sources: (b.sources ?? []).slice(0, 10).map((x) => ({ name: String(x.name).slice(0, 120), text: String(x.text).slice(0, 60_000) })),
    mediaIds: (b.mediaIds ?? []).slice(0, 3),
  };
  const story = await withCredits(cost, () => writeStory(input, { model: premium ? process.env.ANTHROPIC_PREMIUM_MODEL : undefined }));
  await log("info", "generate", `Story script: “${story.out.titles?.[0]?.title ?? story.topic}” (${STORY_FORMATS[story.format].label})`);
  return ok(story);
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Missing id");
  await db().remove("stories", id);
  return ok({ ok: true });
});
