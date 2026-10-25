"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, Mic, Square, Trash2, UserRound, Wand2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SPEECH_LANGUAGES } from "@/lib/languages";

type MediaItem = { id: string; name: string; kind: "image" | "video" | "audio"; url: string; createdAt: string };
export type Voice = { id: string; name: string; consentBy: string; sampleUrl: string; createdAt: string };
type Credits = { speech: number; voiceChangeMinute: number; dubMinute: number; lipsyncSecond: number; footageSecond: number };

/** The person's Media Library (newest first), reloaded when a background job finishes. */
export function useMedia() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const load = useCallback(() => api<{ items: MediaItem[] }>("/api/media").then((d) => setItems([...d.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))).catch(() => {}), []);
  useEffect(() => {
    load();
    window.addEventListener("ghostpost:job-done", load);
    return () => window.removeEventListener("ghostpost:job-done", load);
  }, [load]);
  return { items, reload: load };
}

export function useVoices() {
  const [data, setData] = useState<{ consentSentence: string; voices: Voice[] } | null>(null);
  const load = useCallback(() => api<{ consentSentence: string; voices: Voice[] }>("/api/voices").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  return { data, reload: load };
}

export function useVoiceInfo() {
  const [info, setInfo] = useState<{ engine: boolean; credits: Credits } | null>(null);
  useEffect(() => {
    api<{ engine: boolean; credits: Credits }>("/api/voice-tools").then(setInfo).catch(() => {});
  }, []);
  return info;
}

/** Starts a voice tool in the background. */
export function useRunTool() {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await api<{ credits: number }>("/api/voice-tools", { body });
      jobStarted();
      toast(`Started (${r.credits} credits). It's saved to your Media Library when it's ready.`, "success");
      refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

const pickFrom = (items: MediaItem[], kinds: MediaItem["kind"][]) => items.filter((m) => kinds.includes(m.kind));

export function MediaSelect({ items, kinds, value, onChange, empty }: { items: MediaItem[]; kinds: MediaItem["kind"][]; value: string; onChange: (v: string) => void; empty: string }) {
  const list = pickFrom(items, kinds);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{list.length ? "Choose…" : empty}</option>
      {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </Select>
  );
}

/** My Voices: record or pick a recording that starts with the consent sentence; plus the voice changer. */
export function VoicesPanel() {
  const { toast } = useApp();
  const { items, reload } = useMedia();
  const { data, reload: reloadVoices } = useVoices();
  const info = useVoiceInfo();
  const tool = useRunTool();
  const [name, setName] = useState("");
  const [by, setBy] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [mediaId, setMediaId] = useState("");
  const [saving, setSaving] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [changeId, setChangeId] = useState("");
  const [changeVoice, setChangeVoice] = useState("");

  async function record() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const r = new MediaRecorder(stream, { mimeType: type });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        const fd = new FormData();
        fd.append("files", new File(parts, `my-voice-${Date.now()}.${type === "audio/webm" ? "webm" : "m4a"}`, { type }));
        const res = await fetch("/api/media", { method: "POST", body: fd });
        const j = (await res.json()) as { saved?: { id: string }[]; errors?: string[]; error?: string };
        if (j.saved?.[0]) {
          await reload();
          setMediaId(j.saved[0].id);
          toast("Recording saved. Now name the voice and confirm.", "success");
        } else toast(j.error || j.errors?.[0] || "The recording couldn't be saved.", "error");
        setRec(null);
      };
      r.start();
      setRec(r);
      setSecs(0);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      toast("The microphone isn't available. Allow it in your browser, or upload a recording to the Media Library.", "error");
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/voices", { body: { name, mediaId, consentBy: by, agreed } });
      toast("Voice made. It's in every voice list now.", "success");
      setName("");
      setMediaId("");
      reloadVoices();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Make a voice from your own" subtitle="Speak for 20–60 seconds. Ghost Post checks the consent sentence before it copies any voice." icon={<UserRound className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <div className="rounded-xl border border-mint-400/30 bg-mint-400/10 p-4 text-sm">
            <div className="mb-1 text-xs uppercase tracking-wide text-mint-200">Start the recording by saying</div>
            <div className="text-base font-medium">“{data?.consentSentence ?? "…"}”</div>
            <div className="mt-2 text-xs text-white/60">Then read anything in your normal voice: a quiet room, about a hand&apos;s width from the mic.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rec ? (
              <Button variant="danger" onClick={() => rec.stop()}><Square className="h-4 w-4" /> Stop ({secs}s)</Button>
            ) : (
              <Button variant="primary" onClick={record}><Mic className="h-4 w-4" /> Record</Button>
            )}
            <span className="text-xs text-white/50">or choose a recording you uploaded:</span>
          </div>
          <MediaSelect items={items} kinds={["audio", "video"]} value={mediaId} onChange={setMediaId} empty="No recordings yet" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Voice name"><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. My narrator voice" /></Field>
            <Field label="Your full name"><Input value={by} maxLength={80} onChange={(e) => setBy(e.target.value)} placeholder="As your signature" /></Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-white/80">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 accent-mint-400" />
            This is my own voice, or I have the speaker&apos;s written permission to make an AI copy of it. I won&apos;t use it to deceive anyone.
          </label>
          <Button variant="primary" onClick={save} loading={saving} disabled={!mediaId || !name.trim() || !by.trim() || !agreed}>Make the voice</Button>
          <p className="text-xs text-white/40">Speech made from a voice carries an inaudible watermark, so it can be identified as AI.</p>
        </div>
      </Card>
      <div className="grid h-fit gap-6">
        <Card>
          <CardHeader title="My Voices" subtitle="Use them in Voiceover, the voice changer, dubbing and avatars." />
          <div className="grid gap-3 p-4">
            {!data?.voices.length && <div className="text-sm text-white/50">No voices yet.</div>}
            {data?.voices.map((v) => (
              <div key={v.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.name}</div>
                  <audio src={v.sampleUrl} controls className="mt-1 h-8 w-full" />
                </div>
                <button className="text-white/50 hover:text-red-300" aria-label={`Delete ${v.name}`} onClick={async () => {
                  if (!confirm(`Delete the voice “${v.name}”?`)) return;
                  try {
                    await api(`/api/voices?id=${v.id}`, { method: "DELETE" });
                    reloadVoices();
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Voice changer" subtitle="Keep the performance, change the voice: a recording or a video in one of My Voices." icon={<Wand2 className="h-4 w-4" />} />
          <div className="grid gap-3 p-4">
            <MediaSelect items={items} kinds={["audio", "video"]} value={changeId} onChange={setChangeId} empty="Upload a recording first" />
            <Select value={changeVoice} onChange={(e) => setChangeVoice(e.target.value)}>
              <option value="">Into which voice?</option>
              {data?.voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
            <Button variant="primary" loading={tool.busy} disabled={!changeId || !changeVoice || info?.engine === false} onClick={() => tool.run({ tool: "change", mediaId: changeId, voiceId: changeVoice })}>
              Change the voice{info ? ` · ${info.credits.voiceChangeMinute} credits a minute` : ""}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Dubbing: a video in another language, in the speaker's own voice (with permission) or one of My Voices. */
export function DubPanel() {
  const { items } = useMedia();
  const { data } = useVoices();
  const info = useVoiceInfo();
  const tool = useRunTool();
  const [mediaId, setMediaId] = useState("");
  const [language, setLanguage] = useState("es");
  const [voice, setVoice] = useState("original");
  const [rights, setRights] = useState(false);
  const [keep, setKeep] = useState(true);
  const [lips, setLips] = useState(true);
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Dubbing" subtitle="Ghost Post hears every line, translates it, speaks it at the same moment in the new language and can sync the lips." icon={<Languages className="h-4 w-4" />} />
      <div className="grid gap-4 p-5">
        <Field label="Video or recording"><MediaSelect items={items} kinds={["video", "audio"]} value={mediaId} onChange={setMediaId} empty="Upload a video to the Media Library first" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dub into">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(SPEECH_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Voice">
            <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="original">The original speaker&apos;s voice</option>
              {data?.voices.map((v) => <option key={v.id} value={v.id}>{v.name} (My Voices)</option>)}
            </Select>
          </Field>
        </div>
        {voice === "original" && (
          <label className="flex items-start gap-2 text-sm text-white/80">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 accent-mint-400" />
            I am the speaker in this video, or I have the speaker&apos;s written permission to copy their voice.
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-mint-400" /> Keep the original sound quietly underneath (music and effects)</label>
        <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={lips} onChange={(e) => setLips(e.target.checked)} className="accent-mint-400" /> Lip sync the face to the new words</label>
        <Button variant="primary" size="lg" className="h-auto min-h-12 whitespace-normal py-2 text-left" loading={tool.busy} disabled={!mediaId || (voice === "original" && !rights) || info?.engine === false}
          onClick={() => tool.run({ tool: "dub", mediaId, language, voice, rightsConfirmed: rights, keepBackground: keep, lipsync: lips })}>
          <Languages className="h-4 w-4" /> Dub it{info ? ` · ${info.credits.dubMinute} credits a minute${lips ? ` + ${info.credits.lipsyncSecond} a second for lip sync` : ""}` : ""}
        </Button>
      </div>
    </Card>
  );
}

/** Lip sync a video to new speech, or make an avatar: a picture of a person that speaks. */
export function AvatarPanel() {
  const { items } = useMedia();
  const { data } = useVoices();
  const info = useVoiceInfo();
  const tool = useRunTool();
  const [pictureId, setPictureId] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("en");
  const [voiceId, setVoiceId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [direction, setDirection] = useState("");
  const [videoId, setVideoId] = useState("");
  const [speechId, setSpeechId] = useState("");
  const pics = pickFrom(items, ["image"]);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Avatar" subtitle="A picture of a person, brought to life and speaking your words with synced lips." icon={<UserRound className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Picture (face clearly visible)</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {!pics.length && <div className="text-sm text-white/50">Add a picture to the Media Library or make one in Image Studio.</div>}
              {pics.slice(0, 30).map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.url} alt={p.name} onClick={() => setPictureId(p.id)} className={`h-24 w-[4.5rem] shrink-0 cursor-pointer rounded-lg object-cover ${pictureId === p.id ? "ring-2 ring-mint-400" : "opacity-70 hover:opacity-100"}`} />
              ))}
            </div>
          </div>
          <Field label="What they say" hint="Or choose a recording below">
            <Textarea rows={4} maxLength={3000} value={text} onChange={(e) => { setText(e.target.value); if (e.target.value) setAudioId(""); }} placeholder="Baby, I handle the money. That's what I'm good at." />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!audioId}>
              {Object.entries(SPEECH_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={!!audioId}>
              <option value="">Standard voice</option>
              {data?.voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
            <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
            </Select>
          </div>
          <Field label="…or a recording"><MediaSelect items={items} kinds={["audio"]} value={audioId} onChange={(v) => { setAudioId(v); if (v) setText(""); }} empty="No recordings yet" /></Field>
          <Field label="Direction" hint="Optional"><Input value={direction} maxLength={300} onChange={(e) => setDirection(e.target.value)} placeholder="e.g. She smiles a little at the end" /></Field>
          <Button variant="primary" size="lg" className="h-auto min-h-12 whitespace-normal py-2 text-left" loading={tool.busy} disabled={!pictureId || (!text.trim() && !audioId) || info?.engine === false}
            onClick={() => tool.run({ tool: "avatar", pictureId, text: audioId ? undefined : text, language, voiceId: voiceId || undefined, audioId: audioId || undefined, aspect, direction })}>
            <UserRound className="h-4 w-4" /> Make the avatar{info ? ` · about ${info.credits.footageSecond * 5 + info.credits.lipsyncSecond * Math.max(1, Math.ceil((text.length || 70) / 14))} credits` : ""}
          </Button>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Lip sync" subtitle="Make the face in a video say a new recording. A shorter video plays back and forth until the words end." icon={<Mic className="h-4 w-4" />} />
        <div className="grid gap-3 p-5">
          <Field label="Video with a face"><MediaSelect items={items} kinds={["video"]} value={videoId} onChange={setVideoId} empty="Upload a video first" /></Field>
          <Field label="Speech"><MediaSelect items={items} kinds={["audio"]} value={speechId} onChange={setSpeechId} empty="Make a voiceover or upload a recording" /></Field>
          <Button variant="primary" loading={tool.busy} disabled={!videoId || !speechId || info?.engine === false} onClick={() => tool.run({ tool: "lipsync", videoId, audioId: speechId })}>
            Sync the lips{info ? ` · ${info.credits.lipsyncSecond} credits a second` : ""}
          </Button>
        </div>
      </Card>
    </div>
  );
}
