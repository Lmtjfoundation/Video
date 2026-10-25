import { authed, body, fail, ok } from "@/lib/http-api";
import { refundCredits, spendCredits } from "@/lib/auth";
import { startJob, type JobKind } from "@/lib/jobs";
import { isSpeechLanguage, SPEECH_LANGUAGES } from "@/lib/languages";
import { ownEngineReady } from "@/lib/own-video";
import { CREDIT_COST } from "@/lib/plans";
import { log } from "@/lib/repo";
import { changeVoice, dub, lipSync, makeAvatar, makeSpeech, mediaSeconds } from "@/lib/voice-studio";
import { listVoices } from "@/lib/voices";
import type { MediaItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ASPECTS = ["9:16", "16:9", "1:1"];

export const GET = authed(async () => ok({ languages: SPEECH_LANGUAGES, engine: await ownEngineReady(), credits: { speech: CREDIT_COST.speech, voiceChangeMinute: CREDIT_COST.voiceChangeMinute, dubMinute: CREDIT_COST.dubMinute, lipsyncSecond: CREDIT_COST.lipsyncSecond, footageSecond: CREDIT_COST.ownSecond } }));

/**
 * The voice tools: voiceover in 23 languages or My Voices, voice changer, dubbing, lip sync and avatars. Each runs in
 * the background on the engine; the credits are taken now and given back if it fails.
 */
export const POST = authed(async (req, user) => {
  const b = await body<{
    tool?: string; text?: string; language?: string; voiceId?: string; mediaId?: string; voice?: string; rightsConfirmed?: boolean;
    keepBackground?: boolean; lipsync?: boolean; videoId?: string; audioId?: string; pictureId?: string; aspect?: string; direction?: string;
  }>(req);
  if (!(await ownEngineReady())) return fail("The voice tools need Ghost Post's engine. The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine.", 503);
  const myVoice = async (id?: string) => {
    if (!id) return undefined;
    if (!(await listVoices()).some((v) => v.id === id)) throw new Error("That voice isn't in My Voices.");
    return id;
  };
  let credits: number;
  let kind: JobKind = "voice";
  let title: string;
  let run: () => Promise<MediaItem>;
  switch (b.tool) {
    case "speech": {
      const text = String(b.text ?? "").trim();
      if (!text) return fail("Type what the voice should say.");
      if (text.length > 5000) return fail("Voiceovers can be up to 5,000 characters.");
      if (!isSpeechLanguage(b.language)) return fail("Choose a language.");
      const voiceId = await myVoice(b.voiceId);
      credits = CREDIT_COST.speech * Math.ceil(text.length / 1000);
      title = `Voiceover (${SPEECH_LANGUAGES[b.language]})`;
      const language = b.language;
      run = () => makeSpeech(user.id, { text, language, voiceId });
      break;
    }
    case "change": {
      const voiceId = await myVoice(b.voiceId);
      if (!voiceId || !b.mediaId) return fail("Choose the recording and the voice to change it into.");
      const secs = await mediaSeconds(b.mediaId);
      if (secs > 600) return fail("The voice changer takes recordings of up to 10 minutes.");
      credits = CREDIT_COST.voiceChangeMinute * Math.max(1, Math.ceil(secs / 60));
      title = "Voice changer";
      const mediaId = b.mediaId;
      run = () => changeVoice(user.id, { mediaId, voiceId });
      break;
    }
    case "dub": {
      if (!b.mediaId) return fail("Choose the video to dub.");
      if (!isSpeechLanguage(b.language)) return fail("Choose the language to dub into.");
      const voice = b.voice === "original" ? "original" : await myVoice(b.voice);
      if (!voice) return fail("Choose a voice: the original speaker or one of My Voices.");
      if (voice === "original" && b.rightsConfirmed !== true) return fail("Confirm that you are the speaker in this video or have their written permission to copy their voice.");
      const secs = await mediaSeconds(b.mediaId);
      if (secs > 15 * 60) return fail("Dubbing takes videos of up to 15 minutes.");
      credits = CREDIT_COST.dubMinute * Math.max(1, Math.ceil(secs / 60)) + (b.lipsync ? CREDIT_COST.lipsyncSecond * Math.ceil(secs) : 0);
      kind = "dub";
      title = `Dub into ${SPEECH_LANGUAGES[b.language]}`;
      const o = { mediaId: b.mediaId, language: b.language, voice, rightsConfirmed: b.rightsConfirmed === true, keepBackground: b.keepBackground !== false, lipsync: b.lipsync === true };
      run = () => dub(user.id, o);
      break;
    }
    case "lipsync": {
      if (!b.videoId || !b.audioId) return fail("Choose the video and the speech.");
      const secs = await mediaSeconds(b.audioId);
      if (secs > 300) return fail("Lip sync takes speech of up to 5 minutes.");
      credits = CREDIT_COST.lipsyncSecond * Math.max(1, Math.ceil(secs));
      title = "Lip sync";
      const o = { videoId: b.videoId, audioId: b.audioId };
      run = () => lipSync(user.id, o);
      break;
    }
    case "avatar": {
      if (!b.pictureId) return fail("Choose a picture of the person.");
      const aspect = ASPECTS.includes(String(b.aspect)) ? String(b.aspect) : "9:16";
      let secs: number;
      let audio: { mediaId: string } | { text: string; language: string; voiceId?: string };
      if (b.audioId) {
        secs = await mediaSeconds(b.audioId);
        audio = { mediaId: b.audioId };
      } else {
        const text = String(b.text ?? "").trim();
        if (!text) return fail("Type what the avatar says, or choose a recording.");
        if (!isSpeechLanguage(b.language)) return fail("Choose a language.");
        secs = text.length / 14;
        audio = { text: text.slice(0, 3000), language: b.language, voiceId: await myVoice(b.voiceId) };
      }
      if (secs > 300) return fail("Avatars can speak for up to 5 minutes.");
      credits = (b.audioId ? 0 : CREDIT_COST.speech * Math.ceil(String(b.text ?? "").length / 1000)) + CREDIT_COST.ownSecond * 5 + CREDIT_COST.lipsyncSecond * Math.max(1, Math.ceil(secs));
      kind = "avatar";
      title = "Avatar";
      const o = { pictureId: b.pictureId, aspect, audio, direction: String(b.direction ?? "").slice(0, 300) };
      run = () => makeAvatar(user.id, o);
      break;
    }
    default:
      return fail("Unknown tool.");
  }
  await spendCredits(user.id, credits);
  const job = await startJob(user.id, { kind, title }, async () => {
    try {
      const item = await run();
      await log("info", "generate", `${title}: ${item.name}`);
      return { href: "/media", message: `Saved to your Media Library: ${item.name}` };
    } catch (e) {
      await refundCredits(user.id, credits);
      throw e;
    }
  });
  return ok({ job, credits });
});
