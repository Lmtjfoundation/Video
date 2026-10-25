import { authed, body, fail, ok, RequestError } from "@/lib/http-api";
import { refundCredits, spendCredits } from "@/lib/auth";
import { startJob } from "@/lib/jobs";
import { ownEngineReady, type VideoEditTask } from "@/lib/own-video";
import { CREDIT_COST } from "@/lib/plans";
import { log } from "@/lib/repo";
import { editVideo, musicVideo, musicVideoCredits, smartShot, smartShotCredits, songCuts, videoEditCredits, videoEditSeconds, type MusicVideoInput } from "@/lib/video-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ENGINE_OFF = "Video tools run on Ghost Post's engine (a GPU). The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine.";
const ASPECTS = ["9:16", "16:9", "1:1"];
const TASKS: VideoEditTask[] = ["restyle", "relight", "motion", "background", "inpaint"];
const asked = <T>(p: Promise<T>) =>
  p.catch((e: Error) => {
    throw new RequestError(e.message);
  });

export const GET = authed(async () => ok({ engine: await ownEngineReady(), credits: { image: CREDIT_COST.aiImage, second: CREDIT_COST.ownSecond, editSecond: CREDIT_COST.editSecond } }));

/** Smart Shot, Music Video and video edits. They run in the background; the credits come back if one fails. */
export const POST = authed(async (req, user) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.action === "quote-music") {
    const q = await asked(songCuts(String(b.audioId ?? "")));
    return ok({ ...q, shots: q.cuts.length - 1, credits: { pictures: musicVideoCredits({ motion: "pictures" }, q.cuts), clips: musicVideoCredits({ motion: "clips" }, q.cuts) } });
  }
  if (!(await ownEngineReady())) return fail(ENGINE_OFF, 503);
  const aspect = ASPECTS.includes(String(b.aspect)) ? String(b.aspect) : "9:16";
  let credits: number;
  let title: string;
  let run: (say: (m: string) => void) => Promise<string>;
  switch (b.action) {
    case "smart-shot": {
      const prompt = String(b.prompt ?? "").trim();
      if (!prompt) return fail("Describe the moment to film.");
      const o = { prompt, shots: Math.max(3, Math.min(5, Number(b.shots) || 4)), secondsPerShot: Math.max(2, Math.min(5, Number(b.secondsPerShot) || 4)), aspect, imageId: b.imageId ? String(b.imageId) : undefined };
      credits = smartShotCredits(o);
      title = "Smart Shot";
      run = async (say) => (await smartShot(user.id, o, say)).name;
      break;
    }
    case "music-video": {
      const idea = String(b.idea ?? "").trim();
      if (!idea) return fail("Describe the look and story of the video.");
      const o: MusicVideoInput = { audioId: String(b.audioId ?? ""), idea, aspect, motion: b.motion === "clips" ? "clips" : "pictures" };
      const q = await asked(songCuts(o.audioId));
      credits = musicVideoCredits(o, q.cuts);
      title = "Music video";
      run = async (say) => (await musicVideo(user.id, o, {}, say)).name;
      break;
    }
    case "edit": {
      const task = TASKS.find((t) => t === b.task);
      if (!task) return fail("Choose what to do with the clip.");
      const prompt = String(b.prompt ?? "").trim();
      if (!prompt) return fail("Describe the result you want.");
      if (task === "motion" && !b.imageId) return fail("Choose a picture of who (or what) performs the motion.");
      const box = Array.isArray(b.box) && b.box.length === 4 ? (b.box.map((n) => Math.max(0, Math.min(1, Number(n) || 0))) as [number, number, number, number]) : undefined;
      if (task === "inpaint" && (!box || box[2] < 0.02 || box[3] < 0.02)) return fail("Draw the box to change on the video.");
      const o = { task, videoId: String(b.videoId ?? ""), prompt, imageId: b.imageId ? String(b.imageId) : undefined, box };
      credits = videoEditCredits(await asked(videoEditSeconds(o.videoId)));
      title = { restyle: "Restyle video", relight: "Relight video", motion: "Motion control", background: "New background", inpaint: "Video inpaint" }[task];
      run = async () => (await editVideo(user.id, o)).name;
      break;
    }
    default:
      return fail("Unknown action.");
  }
  await spendCredits(user.id, credits);
  const job = await startJob(user.id, { kind: "footage", title }, async (say) => {
    try {
      const name = await run(say);
      await log("info", "generate", `${title}: ${name}`);
      return { href: "/media", message: `Saved to your Media Library: ${name}` };
    } catch (e) {
      await refundCredits(user.id, credits);
      throw e;
    }
  });
  return ok({ job, credits });
});
