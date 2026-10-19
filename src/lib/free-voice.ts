import "server-only";
import path from "path";

/**
 * Free voiceover that runs on Ghost Post's own server: Kokoro-82M (open weights, Apache 2.0) through kokoro-js.
 * Used when no ElevenLabs key is set, or when ElevenLabs fails (quota, key). The model (about 90 MB) downloads from
 * Hugging Face on first use and is cached on the data volume, so later renders start in a second or two.
 * Set FREE_VOICE=off to turn it off.
 */
type Tts = { generate(text: string, o: { voice: string; speed?: number }): Promise<{ save(file: string): Promise<void> | void }> };
let model: Promise<Tts> | null = null;

export const freeVoiceEnabled = () => process.env.FREE_VOICE !== "off";

async function load(): Promise<Tts> {
  const { env } = await import("@huggingface/transformers");
  env.cacheDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "models");
  const { KokoroTTS } = await import("kokoro-js");
  return (await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" })) as unknown as Tts;
}

/** Picks a Kokoro voice from the plan's voice note, e.g. "warm female narrator" or "deep British male". */
export function kokoroVoice(note = "") {
  const n = note.toLowerCase();
  const female = /\b(female|woman|women|girl|her|she|lady|mother|grandmother|aunt)\b/.test(n);
  const british = /british|english accent|uk\b|london/.test(n);
  if (british) return female ? "bf_emma" : "bm_george";
  if (female) return /young|bright|upbeat|energetic/.test(n) ? "af_bella" : "af_heart";
  return /deep|gravel|low|older|grand/.test(n) ? "am_onyx" : "am_michael";
}

/** Writes the narration as a WAV file. */
export async function freeVoice(text: string, file: string, note?: string) {
  model ??= load().catch((e) => {
    model = null; // try again next time (e.g. the download was interrupted)
    throw e;
  });
  const tts = await model;
  const audio = await tts.generate(text.slice(0, 2000), { voice: kokoroVoice(note) });
  await audio.save(file);
}
