import { authed, body, fail, ok } from "@/lib/http-api";
import { spendCredits } from "@/lib/auth";
import { withCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { signedUrl } from "@/lib/media";
import { CREDIT_COST } from "@/lib/plans";
import { log } from "@/lib/repo";
import { ffmpegAvailable } from "@/lib/render";
import { replicateReady } from "@/lib/replicate-video";
import { elevenlabsKey } from "@/lib/integrations";
import { freeVoiceEnabled } from "@/lib/free-voice";
import { getFilm, listFilms, type FilmProject } from "@/lib/writers-room";
import type { MediaItem } from "@/lib/types";
import { nowIso, uid } from "@/lib/utils";
import {
  clampSeconds, deleteCut, FILM_ASPECTS, FILM_ENGINES, getCut, listCuts, MAX_CUTS, MAX_SEGMENTS, newSegment, planCut, queueAssembly, queueSegment, REF_LIMITS,
  releaseOrphans, saveCut, segmentCredits, voiceLine, writeNextBeat,
  type FilmAspect, type FilmCut, type FilmEngineId, type FilmRef, type FilmSegment,
} from "@/lib/film-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The Film Engine's films, with playable links to every clip, and what this server can do. */
export const GET = authed(async (_req, user) => {
  const cuts = await listCuts();
  for (const c of cuts) await releaseOrphans(user.id, c);
  const link = (id?: string) => (id ? signedUrl(user.id, id, 6 * 3600) : null);
  const fresh = await listCuts();
  return ok({
    cuts: fresh.map((c) => ({
      ...c,
      refs: c.refs.map((r) => ({ ...r, url: link(r.mediaId) })),
      segments: c.segments.map((s) => ({ ...s, clipUrl: link(s.clipMediaId), cost: segmentCredits(c.engine, s.seconds) })),
      finalUrl: c.final?.status === "done" ? link(c.final.mediaId) : null,
    })),
    films: (await listFilms()).map((f) => ({ id: f.id, title: f.title, logline: f.logline })),
    engines: { seedance: await replicateReady(), wan: await replicateReady(), free: true },
    voice: !!(await elevenlabsKey()) || freeVoiceEnabled(),
    ffmpeg: await ffmpegAvailable(),
    limits: { cuts: MAX_CUTS, segments: MAX_SEGMENTS, refs: REF_LIMITS },
    prices: { plan: CREDIT_COST.filmPlan, beat: CREDIT_COST.filmBeat, seedanceSecond: CREDIT_COST.seedanceSecond, wanSecond: CREDIT_COST.wanSecond },
  });
});

type SegmentInput = Partial<Pick<FilmSegment, "id" | "title" | "seconds" | "shots" | "continueFrom">>;
type Body = {
  action?: "create" | "update" | "generate" | "next" | "assemble" | "voice" | "undo";
  id?: string;
  segId?: string;
  fix?: string;
  title?: string;
  story?: string;
  filmId?: string;
  style?: string;
  logline?: string;
  aspect?: FilmAspect;
  engine?: FilmEngineId;
  nativeAudio?: boolean;
  score?: boolean;
  beats?: number;
  seconds?: number;
  plan?: boolean;
  refs?: Pick<FilmRef, "mediaId" | "label" | "id">[];
  segments?: SegmentInput[];
  direction?: string;
  text?: string;
  note?: string;
};

/** A Writers' Room project as a story the director can plan from. */
const storyOf = (f: FilmProject) =>
  [
    `${f.title}: ${f.logline}`,
    `World: ${f.world.setting}; ${f.world.era}. Look: ${f.world.look}. Sound: ${f.world.sound}.`,
    `Characters: ${f.characters.map((c) => `${c.name} (${c.role}) — ${c.look}; voice: ${c.voice}`).join(" | ")}`,
    "Scenes:",
    ...f.scenes.map((s) => `${s.number}. ${s.heading} — ${s.summary} Turn: ${s.turn}`),
  ].join("\n");

/** Checks references against the user's own Media Library and the Seedance limits. */
async function cleanRefs(input: Body["refs"]): Promise<FilmRef[] | string> {
  const out: FilmRef[] = [];
  const count = { image: 0, video: 0, audio: 0 };
  for (const r of (input ?? []).slice(0, 50)) {
    const m = await db().get<MediaItem>("media", String(r.mediaId));
    if (!m) continue;
    if (++count[m.kind] > REF_LIMITS[m.kind]) return `A film can hold up to ${REF_LIMITS.image} pictures, ${REF_LIMITS.video} clips and ${REF_LIMITS.audio} audio references.`;
    const label = String(r.label ?? "").replace(/[@[\]]/g, "").trim().slice(0, 40) || m.name.replace(/\.\w+$/, "").slice(0, 40);
    out.push({ id: r.id && String(r.id).startsWith("ref") ? String(r.id) : uid("ref"), kind: m.kind, mediaId: m.id, label });
  }
  return out;
}

/** Applies the user's edits to the beats, keeping each beat's footage and progress (owned by the server). */
function mergeSegments(current: FilmSegment[], input: SegmentInput[]): FilmSegment[] {
  return input.slice(0, MAX_SEGMENTS).map((s) => {
    const old = current.find((c) => c.id === s.id);
    if (!old) return newSegment(s);
    const edited = { ...old };
    if (typeof s.title === "string") edited.title = s.title.slice(0, 120) || old.title;
    if (s.seconds != null) edited.seconds = clampSeconds(s.seconds);
    if (typeof s.shots === "string") edited.shots = s.shots.slice(0, 4000);
    if (typeof s.continueFrom === "boolean") edited.continueFrom = s.continueFrom;
    return edited;
  });
}

const busy = (s: { status: string }) => s.status === "queued" || s.status === "generating";

export const POST = authed(async (req, user) => {
  const b = await body<Body>(req);

  if (b.action === "create") {
    if ((await listCuts()).length >= MAX_CUTS) return fail(`You have ${MAX_CUTS} films. Delete one to start another.`);
    const film = b.filmId ? await getFilm(String(b.filmId)) : null;
    const story = film ? storyOf(film) : String(b.story ?? "").trim();
    const aspect = FILM_ASPECTS.includes(b.aspect as FilmAspect) ? (b.aspect as FilmAspect) : "9:16";
    const engine = FILM_ENGINES.includes(b.engine as FilmEngineId) ? (b.engine as FilmEngineId) : "seedance";
    const refs = await cleanRefs(b.refs);
    if (typeof refs === "string") return fail(refs);
    const t = nowIso();
    const cut: FilmCut = {
      id: uid("cut"),
      title: String(b.title || film?.title || "Untitled film").slice(0, 120),
      logline: film?.logline ?? "",
      style: String(b.style ?? "").slice(0, 400),
      aspect,
      engine,
      nativeAudio: b.nativeAudio !== false,
      score: !!b.score,
      refs,
      segments: [],
      filmId: film?.id,
      createdAt: t,
      updatedAt: t,
    };
    if (b.plan) {
      if (story.length < 20) return fail("Tell the director the story first: a few sentences, a script, or pick a Writers' Room project.");
      const plan = await withCredits(CREDIT_COST.filmPlan, () =>
        planCut({ title: cut.title, story, style: cut.style, aspect, beats: Number(b.beats) || 3, seconds: Number(b.seconds) || 25, labels: refs.map((r) => r.label) }),
      );
      Object.assign(cut, { title: plan.title, logline: plan.logline || cut.logline, style: plan.style || cut.style, segments: plan.segments });
    }
    if (!cut.segments.length) cut.segments = [newSegment({ title: "Opening", seconds: 20, continueFrom: false })];
    cut.segments[0].continueFrom = false;
    await saveCut(cut);
    await log("info", "generate", `Film Engine: started “${cut.title}” (${cut.segments.length} beats)`);
    return ok(cut);
  }

  if (b.action === "voice") {
    const text = String(b.text ?? "").trim();
    if (text.length < 2) return fail("Write the line to voice.");
    const item = await voiceLine(user.id, text, b.note ? String(b.note).slice(0, 200) : undefined);
    return ok({ ...item, url: signedUrl(user.id, item.id, 6 * 3600) });
  }

  const cut = b.id ? await getCut(String(b.id)) : null;
  if (!cut) return fail("That film wasn't found.", 404);
  await releaseOrphans(user.id, cut);

  switch (b.action) {
    case "update": {
      if (typeof b.title === "string") cut.title = b.title.slice(0, 120) || cut.title;
      if (typeof b.logline === "string") cut.logline = b.logline.slice(0, 400);
      if (typeof b.style === "string") cut.style = b.style.slice(0, 400);
      if (FILM_ASPECTS.includes(b.aspect as FilmAspect)) cut.aspect = b.aspect as FilmAspect;
      if (FILM_ENGINES.includes(b.engine as FilmEngineId)) cut.engine = b.engine as FilmEngineId;
      if (typeof b.nativeAudio === "boolean") cut.nativeAudio = b.nativeAudio;
      if (typeof b.score === "boolean") cut.score = b.score;
      if (b.refs) {
        const refs = await cleanRefs(b.refs);
        if (typeof refs === "string") return fail(refs);
        cut.refs = refs;
      }
      if (b.segments) {
        const working = cut.segments.filter(busy);
        const next = mergeSegments(cut.segments, b.segments);
        // A beat being filmed can't be removed mid-way.
        for (const w of working) if (!next.some((s) => s.id === w.id)) return fail(`“${w.title}” is being filmed. Wait for it to finish before removing it.`);
        cut.segments = next.length ? next : [newSegment({ continueFrom: false })];
      }
      return ok(await saveCut(cut));
    }
    case "next": {
      if (cut.segments.length >= MAX_SEGMENTS) return fail(`A film holds up to ${MAX_SEGMENTS} beats.`);
      const seg = await withCredits(CREDIT_COST.filmBeat, () => writeNextBeat(cut, String(b.direction ?? "").slice(0, 1000)));
      const latest = (await getCut(cut.id)) ?? cut;
      latest.segments.push(seg);
      return ok(await saveCut(latest));
    }
    case "generate": {
      const seg = cut.segments.find((s) => s.id === b.segId);
      if (!seg) return fail("That beat wasn't found.", 404);
      if (busy(seg)) return ok(cut);
      if (!(await ffmpegAvailable())) return fail("Video tools (ffmpeg) aren't installed on this server yet. Ask the admin to add them.", 503);
      if (cut.engine !== "free" && !(await replicateReady()))
        return fail(`${cut.engine === "seedance" ? "Seedance 2.5" : "Wan 2.2"} runs on Replicate, and this server has no Replicate token yet. The admin adds it in Admin → App settings → Integrations → Replicate. Until then, switch the engine to Free.`, 503);
      const fix = b.fix ? String(b.fix).trim().slice(0, 1000) : undefined;
      if (fix && !seg.clipMediaId) return fail("Film this beat first, then fix a moment in it.");
      const credits = segmentCredits(cut.engine, seg.seconds);
      if (credits) await spendCredits(user.id, credits);
      await queueSegment(user.id, cut.id, seg.id, credits, fix);
      return ok(await getCut(cut.id));
    }
    case "undo": {
      const seg = cut.segments.find((s) => s.id === b.segId);
      const previous = seg?.history?.at(-1);
      if (!seg || !previous || busy(seg)) return fail("There's no earlier take of this beat to go back to.");
      seg.history = seg.history!.slice(0, -1);
      seg.clipMediaId = previous;
      seg.message = "Back to the earlier take.";
      return ok(await saveCut(cut));
    }
    case "assemble": {
      if (cut.final && busy(cut.final)) return ok(cut);
      if (!cut.segments.some((s) => s.clipMediaId)) return fail("Film at least one beat first.");
      if (!(await ffmpegAvailable())) return fail("Video tools (ffmpeg) aren't installed on this server yet.", 503);
      await queueAssembly(user.id, cut.id);
      return ok(await getCut(cut.id));
    }
    default:
      return fail("Unknown action.");
  }
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const cut = await getCut(id);
  if (!cut) return fail("That film wasn't found.", 404);
  if (cut.segments.some(busy) || (cut.final && busy(cut.final))) return fail("This film is being made. Wait for it to finish before deleting it.");
  await deleteCut(id);
  return ok({ deleted: id });
});
