import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { refundCredits } from "./auth";
import { getCharacters } from "./characters";
import { wasInterrupted, type JobFn } from "./jobs";
import type { MoviePlan } from "./movie-maker";
import { movieWorkDir, renderChaptered, type RenderInput } from "./movie-maker-render";
import { chapterPlan, labGrade, labOutline, type LongJobInput, type LongOutline } from "./video-lab";
import { batchReady, runBatch, type BatchAsk } from "./azure-batch";
import type { claudeJson } from "./llm";

type Write = typeof claudeJson;
const CAPTURED = Symbol("captured");

/** Records the request a planner would send instead of sending it, so many can go to Azure in one batch. */
function capture(into: (a: { system: string; user: string; maxTokens: number }) => void): Write {
  return (async (o: { system: string; user: string; maxTokens?: number }) => {
    into({ system: o.system, user: o.user, maxTokens: o.maxTokens ?? 4000 });
    throw CAPTURED;
  }) as Write;
}
const answer = (text: string): Write => (async () => JSON.parse(text)) as Write;

/**
 * Writes with the full GPT-5.4 through an Azure batch when it's set up: every request goes in one batch, and each
 * answer is run back through the same planner. Anything the batch can't answer is written the usual way.
 */
export async function batched<T>(dir: string, tag: string, jobs: { id: string; plan: (w: Write) => Promise<T> }[], say: (m: string) => void): Promise<Map<string, T>> {
  const done = new Map<string, T>();
  if (!jobs.length) return done;
  if (await batchReady()) {
    const asks: BatchAsk[] = [];
    for (const j of jobs) await j.plan(capture((a) => asks.push({ id: j.id, ...a }))).catch((e) => { if (e !== CAPTURED) throw e; });
    try {
      const answers = await runBatch(asks, { stateFile: path.join(dir, `${tag}.batch`), say });
      for (const j of jobs) {
        const text = answers.get(j.id);
        if (text) done.set(j.id, await j.plan(answer(text)).catch(() => undefined as T));
      }
    } catch (e) {
      console.warn(`[video-lab] Azure batch: ${(e as Error).message}; writing the usual way.`);
    }
  }
  for (const j of jobs) if (!done.get(j.id)) done.set(j.id, await j.plan(undefined as unknown as Write));
  return done;
}

const exists = (f: string) => fs.access(f).then(() => true, () => false);

/**
 * A long Video Lab video (5 minutes to 1 h 30 min), in the background: the outline, then each chapter's shots, then
 * each chapter filmed and mixed, then the chapters joined. Every finished step is kept, so a server restart carries on
 * where it stopped and nothing is paid twice.
 */
export function longVideoJob(userId: string, input: LongJobInput): JobFn {
  return async (say, ctx) => {
    const dir = path.join(movieWorkDir(ctx.jobId), "lab");
    await fs.mkdir(dir, { recursive: true });
    try {
      const cast = (await getCharacters(input.characterIds)).map((c) => c.name);
      const o = { ...input, cast };
      const outlineFile = path.join(dir, "outline.json");
      let outline: LongOutline;
      if (await exists(outlineFile)) outline = JSON.parse(await fs.readFile(outlineFile, "utf8"));
      else {
        say("Writing the outline…");
        outline = (await batched(dir, "outline", [{ id: "outline", plan: (w) => labOutline(o, w) }], say)).get("outline")!;
        await fs.writeFile(outlineFile, JSON.stringify(outline));
      }
      const file = (i: number) => path.join(dir, `plan${i + 1}.json`);
      const missing: number[] = [];
      for (let i = 0; i < outline.chapters.length; i++) if (!(await exists(file(i)))) missing.push(i);
      if (missing.length) {
        say(`Writing ${missing.length} chapter${missing.length > 1 ? "s" : ""}…`);
        const written = await batched(dir, "chapters", missing.map((i) => ({ id: `ch${i + 1}`, plan: (w: Write) => chapterPlan(o, outline, i, w) })), say);
        for (const i of missing) await fs.writeFile(file(i), JSON.stringify(written.get(`ch${i + 1}`)));
      }
      const plans: MoviePlan[] = [];
      for (let i = 0; i < outline.chapters.length; i++) plans.push(JSON.parse(await fs.readFile(file(i), "utf8")));
      const grade = labGrade(input.style);
      const chapters: RenderInput[] = plans.map((p, i) => ({
        plan: { ...p, title: i === 0 ? outline.title : outline.chapters[i].title },
        grade,
        characterIds: input.characterIds,
        voice: input.voice,
        musicMediaId: input.musicMediaId,
        endCard: i === plans.length - 1 ? "The End" : "",
        fiction: input.style !== "documentary" && input.style !== "ad",
      }));
      const rec = await renderChaptered(userId, outline.title, chapters, say, path.join(dir, "film"));
      const h = Math.floor(rec.seconds / 3600);
      const m = Math.floor((rec.seconds % 3600) / 60);
      return { href: "/video-lab", message: `Video ready: ${rec.title} (${h ? `${h} h ` : ""}${m} min)` };
    } catch (e) {
      if (!wasInterrupted(e) && input.credits) await refundCredits(userId, input.credits);
      throw e;
    }
  };
}
