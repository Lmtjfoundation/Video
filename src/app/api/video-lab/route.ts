import { authed, body, fail, ok } from "@/lib/http-api";
import { listCharacters } from "@/lib/characters";
import { signedUrl } from "@/lib/media";
import { motionEngineReady } from "@/lib/movie-maker-render";
import { picturesReady } from "@/lib/pictures";
import { ffmpegAvailable } from "@/lib/render";
import { isLong, LAB_LENGTHS, LAB_STYLES, labGrade, labPlan, longCredits, type LabLength, type LabStyle } from "@/lib/video-lab";
import { longVideoJob } from "@/lib/video-lab-long";
import { spendCredits } from "@/lib/auth";
import { startJob } from "@/lib/jobs";
import { CREDIT_COST } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** What Video Lab can do here: styles, lengths, the cast, and whether pictures and the motion engine are on. */
export const GET = authed(async (_req, user) =>
  ok({
    styles: Object.fromEntries(Object.entries(LAB_STYLES).map(([k, v]) => [k, v.label])),
    lengths: LAB_LENGTHS,
    characters: (await listCharacters()).map((c) => ({ id: c.id, name: c.name, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
    ready: { pictures: await picturesReady(), engine: (await motionEngineReady()) && (await ffmpegAvailable()) },
    // Long videos are written and filmed in one go; their credits, by length, with and without the voice.
    longCredits: Object.fromEntries((Object.keys(LAB_LENGTHS) as LabLength[]).filter(isLong).map((l) => [l, { voice: longCredits(l, true, CREDIT_COST), silent: longCredits(l, false, CREDIT_COST) }])),
  }),
);

/** {action: "plan", idea, length, style, characterIds} → the shot list, ready to film with Movie Maker's engine. */
export const POST = authed(async (req, user) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.action === "long") {
    const idea = String(b.idea ?? "").trim();
    if (idea.length < 8) return fail("Describe the video in a sentence or two.");
    const length = (Object.keys(LAB_LENGTHS) as LabLength[]).find((k) => k === b.length && isLong(k));
    if (!length) return fail("Choose a length from 5 minutes to 1 hour 30 minutes.");
    if (!(await picturesReady())) return fail("Pictures aren't switched on yet. The admin connects Azure AI in Admin → App settings → Integrations.", 503);
    if (!(await motionEngineReady()) || !(await ffmpegAvailable())) return fail("The motion engine isn't installed on this server yet.", 503);
    const style = (Object.keys(LAB_STYLES) as LabStyle[]).find((k) => k === b.style) ?? "cinematic";
    const voice = b.voice !== false;
    const credits = longCredits(length, voice, CREDIT_COST);
    await spendCredits(user.id, credits);
    const input = { idea: idea.slice(0, 2000), length, style, characterIds: Array.isArray(b.characterIds) ? b.characterIds.map(String).slice(0, 3) : [], voice, musicMediaId: b.musicMediaId ? String(b.musicMediaId) : undefined, credits };
    const job = await startJob(user.id, { kind: "movie", title: `Video Lab: ${idea.slice(0, 60)}`, resume: { kind: "video-lab-long", input } }, longVideoJob(user.id, input));
    return ok({ job, credits });
  }
  if (b.action !== "plan") return fail("Unknown action.");
  const idea = String(b.idea ?? "").trim();
  if (idea.length < 8) return fail("Describe the video in a sentence or two.");
  const length = (Object.keys(LAB_LENGTHS) as LabLength[]).find((k) => k === b.length) ?? "s30";
  const style = (Object.keys(LAB_STYLES) as LabStyle[]).find((k) => k === b.style) ?? "cinematic";
  const ids = Array.isArray(b.characterIds) ? b.characterIds.map(String).slice(0, 3) : [];
  const cast = (await listCharacters()).filter((c) => ids.includes(c.id)).map((c) => c.name);
  const plan = await labPlan({ idea: idea.slice(0, 2000), length, style, cast });
  return ok({ plan, grade: labGrade(style), characterIds: ids });
});
