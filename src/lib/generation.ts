import "server-only";
import { refundCredits, spendCredits, type User } from "./auth";
import { RequestError } from "./http-api";
import { startJob } from "./jobs";
import { FOOTAGE_CATEGORIES, GENRES, MOODS, pickTags, SFX_CATEGORIES } from "./library-tags";
import { ENGINE_CLIP_SECONDS, ownEngineReady } from "./own-video";
import { CREDIT_COST } from "./plans";
import { log } from "./repo";
import { makeFootage, makeMusic, makeSfx, MUSIC_SECONDS, SFX_SECONDS } from "./sound-studio";

const ASPECTS = ["9:16", "16:9", "1:1"];

export interface GenerationRequest {
  kind?: string; prompt?: string; lyrics?: string; seconds?: number; bpm?: number; key?: string;
  genres?: string[]; moods?: string[]; category?: string; aspect?: string; startMediaId?: string;
}

/**
 * AI Music, Sound Effects and Footage, for the AI Studio and the developer API. Always in the background: the credits
 * are taken now (so the answer is immediate when there aren't enough), and they come back if it fails.
 */
export async function startGeneration(user: User, b: GenerationRequest) {
  const prompt = String(b.prompt ?? "").trim().slice(0, 500);
  if (!prompt) throw new RequestError("Describe what to make.");
  if (!(await ownEngineReady())) throw new RequestError("The AI generators need Ghost Post's engine. The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine.", 503);
  const seconds = Number(b.seconds) || 0;
  let credits: number;
  let title: string;
  let make: () => Promise<{ id: string; title: string }>;
  if (b.kind === "music") {
    if (seconds < MUSIC_SECONDS.min || seconds > MUSIC_SECONDS.max) throw new RequestError(`Tracks can be ${MUSIC_SECONDS.min} seconds to ${MUSIC_SECONDS.max / 60} minutes.`);
    const bpm = b.bpm ? Math.round(Number(b.bpm)) : undefined;
    if (bpm !== undefined && (bpm < 30 || bpm > 300)) throw new RequestError("Tempo can be 30 to 300 BPM.");
    credits = CREDIT_COST.aiMusic;
    title = `Music: ${prompt.slice(0, 60)}`;
    make = () => makeMusic(user.id, { prompt, lyrics: String(b.lyrics ?? "").slice(0, 4000), seconds, bpm, key: String(b.key ?? "").slice(0, 12) || undefined, genres: pickTags(GENRES, b.genres, 3), moods: pickTags(MOODS, b.moods, 3) });
  } else if (b.kind === "sfx") {
    if (seconds < SFX_SECONDS.min || seconds > SFX_SECONDS.max) throw new RequestError(`Sound effects can be ${SFX_SECONDS.min} to ${SFX_SECONDS.max} seconds.`);
    credits = CREDIT_COST.aiSfx;
    title = `Sound: ${prompt.slice(0, 60)}`;
    make = () => makeSfx(user.id, { prompt, seconds, category: pickTags(SFX_CATEGORIES, [b.category], 1)[0] });
  } else if (b.kind === "footage") {
    const secs = Math.round(Math.max(1, Math.min(ENGINE_CLIP_SECONDS, seconds || ENGINE_CLIP_SECONDS)));
    credits = CREDIT_COST.ownSecond * secs;
    title = `Footage: ${prompt.slice(0, 60)}`;
    const aspect = ASPECTS.includes(String(b.aspect)) ? String(b.aspect) : "16:9";
    make = () => makeFootage(user.id, { prompt, aspect, seconds: secs, startMediaId: b.startMediaId || undefined, category: pickTags(FOOTAGE_CATEGORIES, [b.category], 1)[0] });
  } else throw new RequestError("Choose music, a sound effect or footage.");

  await spendCredits(user.id, credits);
  const kind = b.kind;
  const job = await startJob(user.id, { kind, title }, async () => {
    try {
      const a = await make();
      await log("info", "generate", `Library ${kind}: ${a.title}`);
      return { href: `/library?kind=${kind}&shelf=mine&item=${a.id}`, message: `“${a.title}” is in your library` };
    } catch (e) {
      await refundCredits(user.id, credits);
      throw e;
    }
  });
  return { job, credits };
}
