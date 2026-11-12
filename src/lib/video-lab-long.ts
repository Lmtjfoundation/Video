import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { refundCredits } from "./auth";
import { getCharacters } from "./characters";
import { wasInterrupted, type JobFn } from "./jobs";
import type { MoviePlan } from "./movie-maker";
import { movieWorkDir, renderChaptered, type RenderInput } from "./movie-maker-render";
import { chapterPlan, labGrade, labOutline, type LongJobInput, type LongOutline } from "./video-lab";

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
        outline = await labOutline(o);
        await fs.writeFile(outlineFile, JSON.stringify(outline));
      }
      const plans: MoviePlan[] = [];
      for (let i = 0; i < outline.chapters.length; i++) {
        const f = path.join(dir, `plan${i + 1}.json`);
        if (await exists(f)) plans.push(JSON.parse(await fs.readFile(f, "utf8")));
        else {
          say(`Writing chapter ${i + 1} of ${outline.chapters.length}: ${outline.chapters[i].title}…`);
          const p = await chapterPlan(o, outline, i);
          await fs.writeFile(f, JSON.stringify(p));
          plans.push(p);
        }
      }
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
