import "server-only";
import { asUser, db } from "./db";
import { kvGet, kvSet } from "./repo";
import type { Post } from "./types";
import { nowIso, uid } from "./utils";

/**
 * Background jobs: making a video (writing the script, transcribing audio, writing an episode, starting a Director
 * storyboard) runs on the server while the person keeps using the app, or leaves it. The jobs tray shows progress
 * and says when each one is ready; a video that renders afterwards is followed through its render too.
 */
export type JobKind = "video" | "audio" | "movie" | "episode" | "director" | "music" | "sfx" | "footage" | "catalog";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  message: string;
  /** The video post it made (its render, if any, is followed in the tray). */
  postId?: string;
  /** Where to open the result. */
  href?: string;
  createdAt: string;
  updatedAt: string;
}

const ROW = "jobs";
const STARTING: Partial<Record<JobKind, string>> = {
  audio: "Listening to the recording…",
  music: "Composing the track…",
  sfx: "Making the sound…",
  footage: "Filming the clip…",
  catalog: "Filling the catalog…",
};
const KEEP = 30;
/** At most this many jobs write at once on this server (each mostly waits on an AI service). */
const PARALLEL = 3;

/** Jobs this server process is running or has waiting (anything else marked running was cut off by a restart). */
const live = new Set<string>();
const waiting: (() => void)[] = [];
let running = 0;

export const listJobs = async (): Promise<Job[]> => (await kvGet<Job[]>(ROW)) ?? [];

/** Writes go one at a time, so two jobs finishing together can't overwrite each other's update. */
let writes: Promise<unknown> = Promise.resolve();
function put(job: Job) {
  job.updatedAt = nowIso();
  const snapshot = { ...job };
  const next = writes.then(async () => {
    const list = await listJobs();
    await kvSet(ROW, [snapshot, ...list.filter((j) => j.id !== snapshot.id)].slice(0, KEEP));
  });
  writes = next.catch(() => {});
  return next;
}

async function slot() {
  if (running < PARALLEL) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}
function release() {
  running--;
  waiting.shift()?.();
}

/**
 * Starts `fn` in the background as the signed-in person and returns the job straight away. `fn` returns the post it
 * made (and where to open it); if it throws, the job fails with the error's message (credits are put back by
 * `withCredits` inside it, as usual).
 */
export async function startJob(userId: string, o: { kind: JobKind; title: string }, fn: () => Promise<{ post?: Post; href?: string; message?: string }>): Promise<Job> {
  const t = nowIso();
  const job: Job = { id: uid("job"), kind: o.kind, title: o.title.slice(0, 120), status: "queued", message: "Waiting to start…", createdAt: t, updatedAt: t };
  await put(job);
  live.add(job.id);
  void (async () => {
    await slot();
    try {
      await asUser(userId, async () => {
        job.status = "running";
        job.message = STARTING[o.kind] ?? "Writing…";
        await put(job);
        try {
          const r = await fn();
          job.status = "done";
          job.postId = r.post?.id;
          job.href = r.href ?? (r.post ? `/post/${r.post.id}` : undefined);
          job.title = (r.post?.hook || job.title).slice(0, 120);
          job.message = r.message ?? "Ready";
        } catch (e) {
          job.status = "failed";
          job.message = (e as Error).message.slice(0, 300) || "Something went wrong. Please try again.";
        }
        await put(job);
      });
    } catch (e) {
      console.error(`[jobs] ${job.id} couldn't be saved: ${(e as Error).message}`);
    } finally {
      live.delete(job.id);
      release();
    }
  })();
  return { ...job, status: "queued", message: "Waiting to start…" };
}

/** A job as the tray shows it: a finished job whose video is rendering reads as rendering, with its progress. */
export interface JobView extends Job {
  progress: number;
}

export async function jobViews(): Promise<JobView[]> {
  const list = await listJobs();
  let changed = false;
  const out: JobView[] = [];
  for (const j of list) {
    // Marked queued/running but no longer on this server: a restart or redeploy stopped it.
    if ((j.status === "queued" || j.status === "running") && !live.has(j.id) && Date.now() - Date.parse(j.updatedAt) > 30_000) {
      j.status = "failed";
      j.message = "The server restarted while this was being made. Please start it again.";
      changed = true;
    }
    const view: JobView = { ...j, progress: j.status === "done" ? 100 : j.status === "running" ? 30 : 0 };
    if (j.status === "done" && j.postId) {
      const p = await db().get<Post>("posts", j.postId);
      const r = p?.render;
      if (r && (r.status === "queued" || r.status === "rendering")) {
        view.status = "running";
        view.progress = r.progress;
        view.message = r.message || "Rendering…";
      } else if (r?.status === "failed") {
        view.status = "failed";
        view.message = r.message || "The render failed.";
      } else if (r?.status === "done") view.message = r.message || "Ready";
    }
    out.push(view);
  }
  if (changed) for (const j of list.filter((x) => x.status === "failed" && !live.has(x.id))) await put(j);
  return out;
}

export async function clearFinished() {
  const next = writes.then(async () => kvSet(ROW, (await listJobs()).filter((j) => j.status === "queued" || j.status === "running")));
  writes = next.catch(() => {});
  await next;
}
