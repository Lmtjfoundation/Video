import "server-only";
import { speechAuth } from "./azure-identity";
import { pick } from "./integrations";
import { stripTags } from "./speech-text";

/**
 * Azure AI Speech on the same Azure AI resource as the pictures (one key): natural neural voices in 100+ languages,
 * and the talking presenter (a lifelike person who says a script with matching lip movement). Both run on Microsoft's
 * GPUs, billed to the Azure subscription; neither needs Curbvue's GPU engine.
 */
export const speechRegion = async () => (await pick("azureAiRegion", "AZURE_AI_REGION")) || "eastus2";
export const azureSpeechReady = async () => !!(await speechAuth("tts"));

/** A short list of Azure's best voices. The multilingual ones also speak 40+ other languages in the same voice. */
export const AZURE_VOICES = [
  { name: "en-US-AndrewMultilingualNeural", label: "Andrew: warm, confident (multilingual)", gender: "Male" },
  { name: "en-US-AvaMultilingualNeural", label: "Ava: bright, friendly (multilingual)", gender: "Female" },
  { name: "en-US-BrianMultilingualNeural", label: "Brian: easygoing, clear (multilingual)", gender: "Male" },
  { name: "en-US-EmmaMultilingualNeural", label: "Emma: cheerful, natural (multilingual)", gender: "Female" },
  { name: "en-US-DavisNeural", label: "Davis: deep, calm", gender: "Male" },
  { name: "en-US-JennyNeural", label: "Jenny: friendly, conversational", gender: "Female" },
  { name: "en-US-GuyNeural", label: "Guy: newsreader, steady", gender: "Male" },
  { name: "en-US-AriaNeural", label: "Aria: expressive storyteller", gender: "Female" },
  { name: "en-GB-RyanNeural", label: "Ryan: British, warm", gender: "Male" },
  { name: "en-GB-SoniaNeural", label: "Sonia: British, polished", gender: "Female" },
  { name: "es-MX-JorgeNeural", label: "Jorge: Spanish (Mexico)", gender: "Male" },
  { name: "es-ES-ElviraNeural", label: "Elvira: Spanish (Spain)", gender: "Female" },
  { name: "fr-FR-HenriNeural", label: "Henri: French", gender: "Male" },
  { name: "fr-FR-DeniseNeural", label: "Denise: French", gender: "Female" },
  { name: "pt-BR-AntonioNeural", label: "Antonio: Portuguese (Brazil)", gender: "Male" },
  { name: "de-DE-ConradNeural", label: "Conrad: German", gender: "Male" },
] as const;
export const isAzureVoice = (name: unknown) => AZURE_VOICES.some((v) => v.name === name);

/** The presenters Azure offers, each in the poses it has. */
export const AVATARS: Record<string, string[]> = {
  lisa: ["casual-sitting", "graceful-sitting", "graceful-standing", "technical-sitting", "technical-standing"],
  harry: ["business", "casual", "youthful"],
  jeff: ["business", "formal"],
  lori: ["casual", "graceful", "formal"],
  max: ["business", "casual", "formal"],
  meg: ["formal", "casual", "business"],
};
export const AVATAR_BACKGROUNDS = { white: "#FFFFFFFF", green: "#00FF00FF", dark: "#111418FF" } as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ssml = (text: string, voice: string, speed = 1) =>
  `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${esc(voice)}"><prosody rate="${Math.round((speed - 1) * 100)}%">${esc(stripTags(text))}</prosody></voice></speak>`;

async function speech(kind: "tts" | "avatar") {
  const a = await speechAuth(kind);
  if (!a) throw new Error("Azure voices aren't set up: add the API Management address (managed identity), or the Azure AI key, in Admin → Integrations.");
  return a;
}

/** Speech as a 48 kHz mono WAV (the app's working format), up to about 9 minutes per call. */
export async function azureSpeak(text: string, voice: string, speed = 1): Promise<Buffer> {
  if (!isAzureVoice(voice)) throw new Error("Choose one of the Azure voices.");
  const words = stripTags(text).trim();
  if (!words) throw new Error("Type what the voice says.");
  const tts = await speech("tts");
  const res = await fetch(tts.url, {
    method: "POST",
    headers: { ...tts.headers, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm", "User-Agent": "ghost-post" },
    body: ssml(words, voice, Math.min(1.3, Math.max(0.7, speed))),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Azure voice failed (${res.status}): ${(await res.text()).slice(0, 200) || "check the Azure AI key and region in Admin"}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface PresenterInput {
  script: string;
  voice: string;
  avatar: string;
  style: string;
  background: keyof typeof AVATAR_BACKGROUNDS;
  captions?: boolean;
}

/** A talking presenter saying the script, as an MP4 (1920×1080). Azure renders it in the background; this waits. */
export async function azurePresenter(o: PresenterInput, onStep?: (m: string) => void): Promise<Buffer> {
  if (!AVATARS[o.avatar]?.includes(o.style)) throw new Error("Choose a presenter and pose.");
  if (!isAzureVoice(o.voice)) throw new Error("Choose one of the Azure voices.");
  const script = stripTags(o.script).trim();
  if (!script) throw new Error("Type what the presenter says.");
  const av = await speech("avatar");
  const base = av.url;
  const headers = { ...av.headers, "Content-Type": "application/json" };
  const id = `gp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const start = await fetch(`${base}/${id}?api-version=2024-08-01`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      inputKind: "PlainText",
      inputs: [{ content: script }],
      synthesisConfig: { voice: o.voice },
      avatarConfig: { talkingAvatarCharacter: o.avatar, talkingAvatarStyle: o.style, videoFormat: "mp4", videoCodec: "h264", subtitleType: o.captions ? "hard_embedded" : "none", backgroundColor: AVATAR_BACKGROUNDS[o.background] ?? AVATAR_BACKGROUNDS.white },
    }),
  });
  if (!start.ok) throw new Error(`Azure presenter couldn't start (${start.status}): ${(await start.text()).slice(0, 240)}`);
  onStep?.("Azure is filming the presenter…");
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, i < 3 ? 5000 : 10000));
    const j = (await (await fetch(`${base}/${id}?api-version=2024-08-01`, { headers })).json()) as { status: string; outputs?: { result?: string }; properties?: { error?: { message?: string } } };
    if (j.status === "Succeeded" && j.outputs?.result) {
      const video = await fetch(j.outputs.result);
      if (!video.ok) throw new Error(`Couldn't download the presenter video (${video.status}).`);
      void fetch(`${base}/${id}?api-version=2024-08-01`, { method: "DELETE", headers }).catch(() => {});
      return Buffer.from(await video.arrayBuffer());
    }
    if (j.status === "Failed") throw new Error(`Azure couldn't make the presenter: ${j.properties?.error?.message ?? "unknown reason"}`);
  }
  throw new Error("Azure took too long to film the presenter. Try a shorter script.");
}
