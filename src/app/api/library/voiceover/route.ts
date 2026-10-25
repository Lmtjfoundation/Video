import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { freeVoiceEnabled, KOKORO_VOICES } from "@/lib/free-voice";
import { signedUrl } from "@/lib/media";
import { CREDIT_COST } from "@/lib/plans";
import { makeVoiceover, VOICE_MAX_CHARS } from "@/lib/sound-studio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = authed(async () => ok({ voices: KOKORO_VOICES, maxChars: VOICE_MAX_CHARS, creditsPer1000: CREDIT_COST.voiceover, enabled: freeVoiceEnabled() }));

/** AI Voiceover: text read aloud by a free voice on Ghost Post's own server, saved to the Media Library. */
export const POST = authed(async (req, user) => {
  const b = await body<{ text?: string; voice?: string; speed?: number }>(req);
  const text = String(b.text ?? "").trim();
  if (!text) return fail("Type what the voice should say.");
  if (text.length > VOICE_MAX_CHARS) return fail(`Voiceovers can be up to ${VOICE_MAX_CHARS.toLocaleString()} characters.`);
  if (!freeVoiceEnabled()) return fail("Voiceover is switched off on this server.", 503);
  if (!KOKORO_VOICES.some((v) => v.id === b.voice)) return fail("Choose a voice.");
  const speed = Math.max(0.7, Math.min(1.3, Number(b.speed) || 1));
  const credits = CREDIT_COST.voiceover * Math.ceil(text.length / 1000);
  const item = await withCredits(credits, () => makeVoiceover(user.id, { text, voice: String(b.voice), speed }));
  return ok({ id: item.id, name: item.name, url: signedUrl(user.id, item.id, 6 * 3600), credits });
});
