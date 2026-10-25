import { authed, body, fail, ok, RequestError } from "@/lib/http-api";
import { refundCredits, spendCredits } from "@/lib/auth";
import { startJob, type JobKind } from "@/lib/jobs";
import { SPEECH_LANGUAGES } from "@/lib/languages";
import { signedUrl } from "@/lib/media";
import { ownEngineReady } from "@/lib/own-video";
import { CREDIT_COST } from "@/lib/plans";
import { log } from "@/lib/repo";
import { stripTags } from "@/lib/speech-text";
import type { VoiceChoice } from "@/lib/voice-catalog";
import {
  audioProjectCredits, checkVoice, deleteAudioProject, deleteTranscript, designVoice, freeSpeak, isolateVoice, labSpeech, listAudioProjects,
  listTranscripts, renderAudioProject, saveAudioProject, transcribeMedia, voiceCredits, voiceToVideo, voiceToVideoCredits, type AudioProject,
  type VoiceToVideoOptions,
} from "@/lib/voice-lab";
import { mediaSeconds } from "@/lib/voice-studio";
import { addDesignedVoice } from "@/lib/voices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ENGINE_OFF = "This needs Ghost Post's engine (a GPU). The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine. Free voices and Speech to Text work without it.";

/** A bad choice in the request (unknown voice, missing file) is the caller's to fix: a 400, not a 500. */
const asked = <T>(p: Promise<T>) => p.catch((e: Error) => {
  throw new RequestError(e.message);
});

export const GET = authed(async (_req, user) => {
  const projects = await listAudioProjects();
  return ok({
    engine: await ownEngineReady(),
    languages: SPEECH_LANGUAGES,
    credits: { voiceover: CREDIT_COST.voiceover, speech: CREDIT_COST.speech, voiceDesign: CREDIT_COST.voiceDesign, isolateMinute: CREDIT_COST.isolateMinute, lipsyncSecond: CREDIT_COST.lipsyncSecond },
    transcripts: await listTranscripts(),
    projects: projects.map((p) => ({ ...p, credits: audioProjectCredits(p), renderUrl: p.renderId ? signedUrl(user.id, p.renderId, 6 * 3600) : undefined })),
  });
});

/** Free voice previews, made once per voice and kept in memory. */
const previews = new Map<string, Promise<Buffer>>();
const PREVIEW = "Hi there! This is how I sound. I can read your story, your ad or your next video.";

/** The Voice Lab tools. Long ones run in the background; the credits are taken now and given back if it fails. */
export const POST = authed(async (req, user) => {
  const b = await body<Record<string, unknown>>(req);
  const engine = await ownEngineReady();
  const needsEngine = (v?: VoiceChoice) => {
    if (!engine && (!v || v.kind === "engine")) throw new RequestError(ENGINE_OFF, 503);
  };
  let credits = 0;
  let kind: JobKind = "voice";
  let title: string;
  let href = "/media";
  let run: () => Promise<string>;
  switch (b.action) {
    case "preview": {
      const id = String(b.voiceId ?? "");
      const v = await asked(checkVoice({ kind: "free", id }));
      if (!previews.has(id)) {
        const p = freeSpeak(PREVIEW, v.kind === "free" ? v.id : id);
        previews.set(id, p);
        p.catch(() => previews.delete(id));
      }
      return new Response(new Uint8Array(await previews.get(id)!), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" } });
    }
    case "speech": {
      const text = String(b.text ?? "").trim();
      if (!stripTags(text)) return fail("Type what the voice should say.");
      if (text.length > 5000) return fail("Text to speech takes up to 5,000 characters at a time. Use Audio Studio for longer pieces.");
      const voice = await asked(checkVoice(b.voice));
      needsEngine(voice);
      credits = voiceCredits(stripTags(text).length, voice);
      title = "Text to speech";
      run = async () => (await labSpeech(user.id, { text, voice })).name;
      break;
    }
    case "design": {
      needsEngine();
      const description = String(b.description ?? "").trim().slice(0, 600);
      if (description.length < 10) return fail("Describe the voice in a sentence: age, tone, pace, accent, how close to the mic.");
      credits = CREDIT_COST.voiceDesign;
      title = "Voice design";
      href = "/voice-lab?tab=design";
      const o = { description, text: String(b.text ?? "").slice(0, 600) || undefined, seed: Number.isInteger(b.seed) ? Number(b.seed) : undefined };
      run = async () => (await designVoice(user.id, o)).name;
      break;
    }
    case "save-designed": {
      const v = await asked(addDesignedVoice({ name: String(b.name ?? ""), mediaId: String(b.mediaId ?? ""), description: String(b.description ?? "") }));
      return ok({ id: v.id, name: v.name });
    }
    case "transcribe": {
      const mediaId = String(b.mediaId ?? "");
      const secs = await asked(mediaSeconds(mediaId));
      if (secs > 60 * 60) return fail("Speech to Text takes recordings of up to an hour.");
      kind = "transcribe";
      title = "Speech to text";
      href = "/voice-lab?tab=stt";
      run = async () => {
        const t = await transcribeMedia({ mediaId });
        return `${t.lines.length} lines from ${t.name}`;
      };
      break;
    }
    case "transcript-delete":
      await deleteTranscript(String(b.id ?? ""));
      return ok({ ok: true });
    case "isolate": {
      needsEngine();
      const mediaId = String(b.mediaId ?? "");
      const stem = b.stem === "background" ? "background" : "vocals";
      const secs = await asked(mediaSeconds(mediaId));
      if (secs > 30 * 60) return fail("The voice isolator takes recordings of up to 30 minutes.");
      credits = CREDIT_COST.isolateMinute * Math.max(1, Math.ceil(secs / 60));
      kind = "isolate";
      title = stem === "vocals" ? "Voice isolator" : "Remove the voice";
      run = async () => (await isolateVoice(user.id, { mediaId, stem })).name;
      break;
    }
    case "project-save": {
      const p = await asked(saveAudioProject((b.project ?? {}) as Partial<AudioProject>));
      return ok({ project: { ...p, credits: audioProjectCredits(p) } });
    }
    case "project-delete":
      await deleteAudioProject(String(b.id ?? ""));
      return ok({ ok: true });
    case "project-render": {
      const p = (await listAudioProjects()).find((x) => x.id === b.id);
      if (!p) return fail("That project wasn't found.", 404);
      const blocks = p.chapters.flatMap((c) => c.blocks);
      if (!blocks.length) return fail("Write at least one paragraph first.");
      if (blocks.some((x) => x.voice.kind === "engine")) needsEngine();
      credits = audioProjectCredits(p);
      kind = "studio";
      title = `Audio Studio: ${p.title}`;
      href = "/voice-lab?tab=studio";
      run = async () => (await renderAudioProject(user.id, p.id)).name;
      break;
    }
    case "voice-to-video": {
      const v = (b.voice ?? {}) as { mediaId?: string; text?: string; choice?: unknown };
      let voice: VoiceToVideoOptions["voice"];
      let secs: number;
      if (v.mediaId) {
        voice = { mediaId: String(v.mediaId) };
        secs = await asked(mediaSeconds(voice.mediaId));
      } else {
        const text = String(v.text ?? "").trim();
        if (!stripTags(text)) return fail("Type what the voice says, record it, or choose a recording.");
        if (text.length > 5000) return fail("Up to 5,000 characters.");
        const choice = await asked(checkVoice(v.choice));
        needsEngine(choice);
        voice = { text, choice };
        secs = stripTags(text).length / 14;
      }
      if (secs > 10 * 60) return fail("Voice to video takes up to 10 minutes of voice.");
      const o: VoiceToVideoOptions = { videoId: String(b.videoId ?? ""), voice, mix: b.mix === "duck" ? "duck" : "replace", captions: b.captions === true, lipsync: b.lipsync === true };
      if (!o.videoId) return fail("Choose the video.");
      if (o.lipsync) needsEngine();
      credits = voiceToVideoCredits(o, secs);
      title = "Voice to video";
      run = async () => (await voiceToVideo(user.id, o)).name;
      break;
    }
    default:
      return fail("Unknown action.");
  }
  if (credits) await spendCredits(user.id, credits);
  const job = await startJob(user.id, { kind, title }, async () => {
    try {
      const done = await run();
      await log("info", "generate", `${title}: ${done}`);
      return { href, message: kind === "transcribe" ? `Transcribed: ${done}` : `Saved to your Media Library: ${done}` };
    } catch (e) {
      if (credits) await refundCredits(user.id, credits);
      throw e;
    }
  });
  return ok({ job, credits });
});
