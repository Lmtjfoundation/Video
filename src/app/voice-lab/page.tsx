"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AudioLines, BookAudio, Captions, ChevronDown, ChevronUp, Copy, Download, Library, Mic, Play, Plus, Sparkles, Square, Trash2, Video, Wand2, Waves } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Switch, Textarea } from "@/components/ui";
import { MediaSelect, useMedia, useVoices } from "@/components/voice-tools";
import { VoicePicker } from "@/components/voice-picker";
import { RecordVoiceTab } from "@/components/record-voice";
import { EMOTION_TAGS, stripTags, toSrt, toTxt, toVtt, type TimedText } from "@/lib/speech-text";
import { DESIGN_PRESETS, STOCK_VOICES, VOICE_USES, type VoiceChoice, type VoiceUse } from "@/lib/voice-catalog";

type Tab = "record" | "tts" | "library" | "design" | "stt" | "isolate" | "studio" | "v2v";
const TABS: { id: Tab; label: string; icon: typeof Mic }[] = [
  { id: "record", label: "Record Voice", icon: Mic },
  { id: "tts", label: "Text to Speech", icon: AudioLines },
  { id: "library", label: "Voice Library", icon: Library },
  { id: "design", label: "Voice Design", icon: Sparkles },
  { id: "stt", label: "Speech to Text", icon: Captions },
  { id: "isolate", label: "Voice Isolator", icon: Waves },
  { id: "studio", label: "Audio Studio", icon: BookAudio },
  { id: "v2v", label: "Voice to Video", icon: Video },
];

type Credits = { voiceover: number; speech: number; voiceDesign: number; isolateMinute: number; lipsyncSecond: number };
type Block = { id: string; text: string; voice: VoiceChoice };
type Chapter = { id: string; title: string; blocks: Block[] };
type Project = { id: string; title: string; chapters: Chapter[]; updatedAt: string; credits: number; renderUrl?: string };
type Transcript = { id: string; name: string; seconds: number; lines: TimedText[]; createdAt: string };
type Info = { engine: boolean; isolate?: boolean; languages: Record<string, string>; credits: Credits; transcripts: Transcript[]; projects: Project[] };

const DEFAULT_VOICE: VoiceChoice = { kind: "free", id: "af_heart", speed: 1 };
const voiceCost = (chars: number, v: VoiceChoice, c?: Credits) => (c ? (v.kind === "free" ? c.voiceover : c.speech) * Math.max(1, Math.ceil(chars / 1000)) : 0);
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

function useInfo() {
  const [info, setInfo] = useState<Info | null>(null);
  const load = useCallback(() => api<Info>("/api/voice-lab").then(setInfo).catch(() => {}), []);
  useEffect(() => {
    load();
    window.addEventListener("ghostpost:job-done", load);
    return () => window.removeEventListener("ghostpost:job-done", load);
  }, [load]);
  return { info, reload: load };
}

/** Starts a Voice Lab tool in the background (the jobs tray shows its progress). */
function useRun() {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>, done = "It's saved to your Media Library when it's ready.") => {
    setBusy(true);
    try {
      const r = await api<{ credits: number }>("/api/voice-lab", { body });
      jobStarted();
      toast(`Started${r.credits ? ` (${r.credits} credits)` : " (free)"}. ${done}`, "success");
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

/** Records from the microphone into the Media Library and hands back the new item's id. */
function Recorder({ onSaved, label = "Record" }: { onSaved: (id: string) => void; label?: string }) {
  const { toast } = useApp();
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const r = new MediaRecorder(stream, { mimeType: type });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRec(null);
        setSaving(true);
        try {
          const fd = new FormData();
          fd.append("files", new File(parts, `recording-${Date.now()}.${type === "audio/webm" ? "webm" : "m4a"}`, { type }));
          const res = await fetch("/api/media", { method: "POST", body: fd });
          const j = (await res.json()) as { saved?: { id: string }[]; errors?: string[]; error?: string };
          if (j.saved?.[0]) {
            onSaved(j.saved[0].id);
            toast("Recording saved to your Media Library.", "success");
          } else toast(j.error || j.errors?.[0] || "The recording couldn't be saved.", "error");
        } finally {
          setSaving(false);
        }
      };
      r.start();
      setRec(r);
      setSecs(0);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      toast("The microphone isn't available. Allow it in your browser, or upload a recording to the Media Library.", "error");
    }
  }
  return rec ? (
    <Button variant="danger" onClick={() => rec.stop()}><Square className="h-4 w-4" /> Stop ({secs}s)</Button>
  ) : (
    <Button onClick={start} loading={saving}><Mic className="h-4 w-4" /> {label}</Button>
  );
}

function download(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function EngineNote({ info, what }: { info: Info | null; what: string }) {
  if (!info || info.engine) return null;
  return <div className="rounded-xl border border-gold-300/30 bg-gold-300/10 p-3 text-xs text-white/75">{what} needs Ghost Post&apos;s engine (a GPU), which isn&apos;t connected yet. The admin connects it in Admin → App settings → Integrations.</div>;
}

/** The latest Media Library items whose names start with one of `prefixes`, with players. */
function Recent({ prefixes, kind = "audio", title = "Latest" }: { prefixes: string[]; kind?: "audio" | "video"; title?: string }) {
  const { items } = useMedia();
  const list = items.filter((m) => m.kind === kind && prefixes.some((p) => m.name.startsWith(p))).slice(0, 4);
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader title={title} subtitle="Also in your Media Library." />
      <div className="grid gap-3 p-4">
        {list.map((m) => (
          <div key={m.id} className="grid gap-1">
            <div className="truncate text-xs text-white/60">{m.name}</div>
            {kind === "audio" ? <audio src={m.url} controls className="h-9 w-full" /> : <video src={m.url} controls playsInline className="max-h-80 w-full rounded-lg bg-black" />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TtsTab({ info, voice, setVoice }: { info: Info | null; voice: VoiceChoice; setVoice: (v: VoiceChoice) => void }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const tool = useRun();
  const chars = stripTags(text).length;
  const insert = (tag: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}${at && !/\s$/.test(text.slice(0, at)) ? " " : ""}[${tag}] ${text.slice(at)}`;
    setText(next.slice(0, 5000));
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0">
        <CardHeader title="Text to speech" subtitle="Type or paste a script. Emotion tags change how the words after them are read." icon={<AudioLines className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <Textarea ref={area} rows={9} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)} placeholder={"Welcome back. [whispers] I have a secret for you. [pause] [excited] And it changes everything!"} />
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(EMOTION_TAGS).map(([k, t]) => (
              <button key={k} type="button" onClick={() => insert(k)} title={t.label} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">[{k}]</button>
            ))}
          </div>
          <p className="text-xs text-white/45">Free voices read pauses and loudness from the tags; engine voices also act the emotion. {chars.toLocaleString()} / 5,000 characters.</p>
          <Field label="Voice"><VoicePicker value={voice} onChange={setVoice} languages={info?.languages} /></Field>
          {voice.kind === "engine" && <EngineNote info={info} what="This voice" />}
          <Button variant="primary" size="lg" loading={tool.busy} disabled={!chars || (voice.kind === "engine" && info?.engine === false)} onClick={() => tool.run({ action: "speech", text, voice })}>
            Generate speech{chars ? ` · ${voiceCost(chars, voice, info?.credits)} credits` : ""}
          </Button>
        </div>
      </Card>
      <div className="grid h-fit gap-6">
        <Recent prefixes={["speech-"]} title="Your latest speech" />
        <Card className="p-4 text-sm text-white/65">
          Need a voice of your own? <Link href="/create?kind=voices" className="text-mint-300 underline">Clone your voice</Link> (with spoken consent) or <Link href="/voice-lab?tab=design" className="text-mint-300 underline">design one from a description</Link>.
        </Card>
      </div>
    </div>
  );
}

function LibraryTab({ use, onUse, onDesign }: { use?: VoiceUse; onUse: (v: VoiceChoice) => void; onDesign: (description: string) => void }) {
  const { toast } = useApp();
  const { data } = useVoices();
  const [filter, setFilter] = useState<VoiceUse | "">(use ?? "");
  const [gender, setGender] = useState("");
  const [accent, setAccent] = useState("");
  const [playing, setPlaying] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const list = STOCK_VOICES.filter((v) => (!filter || v.uses.includes(filter)) && (!gender || v.gender === gender) && (!accent || v.accent === accent));
  async function preview(id: string) {
    audio.current?.pause();
    setPlaying(id);
    try {
      const res = await fetch("/api/voice-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", voiceId: id }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "The preview couldn't play.");
      const a = new Audio(URL.createObjectURL(await res.blob()));
      audio.current = a;
      a.onended = () => setPlaying("");
      await a.play();
    } catch (e) {
      toast((e as Error).message, "error");
      setPlaying("");
    }
  }
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {(["", ...VOICE_USES] as const).map((u) => (
          <button key={u || "all"} onClick={() => setFilter(u)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", filter === u ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>{u || "All uses"}</button>
        ))}
        <Select aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value)} className="w-32"><option value="">Any voice</option><option>Female</option><option>Male</option></Select>
        <Select aria-label="Accent" value={accent} onChange={(e) => setAccent(e.target.value)} className="w-36"><option value="">Any accent</option><option>American</option><option>British</option></Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((v) => (
          <Card key={v.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <button onClick={() => preview(v.id)} aria-label={`Preview ${v.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-mint-400/15 text-mint-200 hover:bg-mint-400/25">
                {playing === v.id ? <Waves className="h-5 w-5 animate-pulse" /> : <Play className="h-5 w-5" />}
              </button>
              <div className="min-w-0">
                <div className="font-semibold">{v.name} <span className="text-xs font-normal text-white/45">· {v.gender}, {v.accent}</span></div>
                <div className="text-sm text-white/65">{v.description}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">{v.uses.map((u) => <Badge key={u}>{u}</Badge>)}<Badge tone="mint">Free</Badge></div>
            <Button size="sm" onClick={() => onUse({ kind: "free", id: v.id, speed: 1 })}>Use this voice</Button>
          </Card>
        ))}
        {!list.length && <div className="text-sm text-white/50">No free voice matches. Try Voice Design below.</div>}
      </div>
      {!!data?.voices.length && (
        <Card>
          <CardHeader title="My Voices" subtitle="Cloned with consent or designed. They speak all 23 languages on the engine." />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {data.voices.map((v) => (
              <div key={v.id} className="grid gap-2 rounded-xl bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-sm font-medium">{v.name} <Badge tone={(v as { designed?: string }).designed ? "violet" : "gold"}>{(v as { designed?: string }).designed ? "designed" : "cloned"}</Badge></div>
                <audio src={v.sampleUrl} controls className="h-8 w-full" />
                <Button size="sm" onClick={() => onUse({ kind: "engine", language: "en", voiceId: v.id })}>Use this voice</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Design a voice for…" subtitle="Starting points for Voice Design. Each makes a new voice that speaks 23 languages." icon={<Sparkles className="h-4 w-4" />} />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {DESIGN_PRESETS.filter((p) => !filter || p.uses.includes(filter)).map((p) => (
            <button key={p.name} onClick={() => onDesign(p.description)} className="rounded-xl bg-white/[0.03] p-3 text-left hover:bg-white/[0.07]">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="mt-1 text-xs text-white/55">{p.description}</div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DesignTab({ info, description, setDescription }: { info: Info | null; description: string; setDescription: (s: string) => void }) {
  const { toast } = useApp();
  const { items } = useMedia();
  const { reload } = useVoices();
  const tool = useRun();
  const [text, setText] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const samples = items.filter((m) => m.kind === "audio" && m.name.startsWith("designed-voice-")).slice(0, 6);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="min-w-0">
        <CardHeader title="Voice design" subtitle="Describe a voice that doesn't exist yet: age, tone, pace, accent, how close to the mic." icon={<Sparkles className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <Textarea rows={4} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A warm older man with a slight Southern drawl, unhurried and friendly, close to the microphone." />
          <div className="flex flex-wrap gap-1.5">
            {DESIGN_PRESETS.map((p) => <button key={p.name} onClick={() => setDescription(p.description)} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">{p.name}</button>)}
          </div>
          <Field label="Sample line" hint="optional"><Input value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder="Leave empty for a 15-second sample story" /></Field>
          <EngineNote info={info} what="Voice design" />
          <Button variant="primary" size="lg" loading={tool.busy} disabled={description.trim().length < 10 || info?.engine === false} onClick={() => tool.run({ action: "design", description, text, seed: Math.floor(Math.random() * 1e6) }, "The sample appears here when it's ready.")}>
            <Wand2 className="h-4 w-4" /> Design the voice · {info?.credits.voiceDesign ?? 2} credits
          </Button>
          <p className="text-xs text-white/45">Each try gives a different voice from the same description. Keep the one you like: it joins My Voices and speaks every language.</p>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Your designed samples" subtitle="Name one and keep it in My Voices." />
        <div className="grid gap-4 p-4">
          {!samples.length && <div className="text-sm text-white/50">Nothing yet. Describe a voice and press Design.</div>}
          {samples.map((m) => (
            <div key={m.id} className="grid gap-2 rounded-xl bg-white/[0.03] p-3">
              <audio src={m.url} controls className="h-8 w-full" />
              <div className="flex gap-2">
                <Input value={names[m.id] ?? ""} maxLength={40} onChange={(e) => setNames({ ...names, [m.id]: e.target.value })} placeholder="Voice name" className="h-9" />
                <Button size="sm" variant="primary" disabled={!names[m.id]?.trim()} onClick={async () => {
                  try {
                    await api("/api/voice-lab", { body: { action: "save-designed", mediaId: m.id, name: names[m.id], description: description || m.name.replace(/^designed-voice-|\.wav$/g, "").replace(/-/g, " ") } });
                    toast("Saved to My Voices.", "success");
                    reload();
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}>Keep</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SttTab({ info, reload }: { info: Info | null; reload: () => void }) {
  const { toast } = useApp();
  const { items, reload: reloadMedia } = useMedia();
  const [mediaId, setMediaId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const tool = useRun();
  const base = (t: Transcript) => t.name.replace(/\.[a-z0-9]+$/i, "");
  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader title="Speech to text" subtitle="Every word with its timing, in any language Whisper knows. Free, on Ghost Post's own server." icon={<Captions className="h-4 w-4" />} />
        <div className="grid gap-3 p-4">
          <MediaSelect items={items} kinds={["audio", "video"]} value={mediaId} onChange={setMediaId} empty="Upload a recording or video first" />
          <div className="flex items-center gap-2 text-xs text-white/50"><Recorder label="Record now" onSaved={(id) => { reloadMedia(); setMediaId(id); }} /> or pick a file above.</div>
          <Button variant="primary" loading={tool.busy} disabled={!mediaId} onClick={() => tool.run({ action: "transcribe", mediaId }, "The transcript appears here when it's ready.")}>Transcribe (free)</Button>
          <p className="text-xs text-white/45">Up to an hour per file. Download as SRT or VTT captions, or plain text.</p>
        </div>
      </Card>
      <div className="grid h-fit gap-3">
        {!info?.transcripts.length && <Card className="p-5 text-sm text-white/50">Your transcripts appear here.</Card>}
        {info?.transcripts.map((t) => (
          <Card key={t.id} className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 p-4">
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <div className="truncate font-medium">{t.name}</div>
                <div className="text-xs text-white/50">{t.lines.length} lines · {Math.round(t.seconds)} s · {new Date(t.createdAt).toLocaleString()}</div>
              </button>
              <Button size="sm" onClick={() => download(`${base(t)}.srt`, toSrt(t.lines))}><Download className="h-3.5 w-3.5" /> SRT</Button>
              <Button size="sm" onClick={() => download(`${base(t)}.vtt`, toVtt(t.lines), "text/vtt")}>VTT</Button>
              <Button size="sm" onClick={() => download(`${base(t)}.txt`, toTxt(t.lines))}>TXT</Button>
              <Button size="sm" variant="ghost" aria-label="Copy text" onClick={async () => toast((await copyToClipboard(toTxt(t.lines))) ? "Copied" : "Couldn't copy", "success")}><Copy className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label="Delete transcript" onClick={async () => { await api("/api/voice-lab", { body: { action: "transcript-delete", id: t.id } }); reload(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            {open === t.id && (
              <div className="max-h-96 overflow-y-auto border-t border-white/[0.06] p-4 text-sm">
                {t.lines.map((l, i) => (
                  <p key={i} className="py-0.5"><span className="mr-2 font-mono text-xs text-white/40">{new Date(l.start * 1000).toISOString().slice(l.start >= 3600 ? 11 : 14, 19)}</span>{l.text}</p>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function IsolateTab({ info }: { info: Info | null }) {
  const { items } = useMedia();
  const [mediaId, setMediaId] = useState("");
  const [stem, setStem] = useState<"vocals" | "background">("vocals");
  const tool = useRun();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0">
        <CardHeader title="Voice isolator" subtitle="Pull a clean voice out of music, wind, traffic and room noise, or remove the voice and keep the rest." icon={<Waves className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <MediaSelect items={items} kinds={["audio", "video"]} value={mediaId} onChange={setMediaId} empty="Upload a recording or video first" />
          <div className="grid gap-2 sm:grid-cols-2">
            {([["vocals", "Keep the voice", "Removes music and noise: clean dialogue, podcasts, interviews."], ["background", "Remove the voice", "Keeps music and effects: karaoke, re-voicing, dubbing beds."]] as const).map(([k, t, d]) => (
              <button key={k} onClick={() => setStem(k)} className={cn("rounded-xl border p-3 text-left", stem === k ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")}>
                <div className="text-sm font-medium">{t}</div>
                <div className="mt-1 text-xs text-white/55">{d}</div>
              </button>
            ))}
          </div>
          {info?.isolate === false && <EngineNote info={{ ...info, engine: false }} what="The voice isolator" />}
          <Button variant="primary" size="lg" loading={tool.busy} disabled={!mediaId || info?.isolate === false} onClick={() => tool.run({ action: "isolate", mediaId, stem })}>
            Separate · {info?.credits.isolateMinute ?? 1} credit a minute
          </Button>
          <p className="text-xs text-white/45">A video keeps its picture with the new sound. Up to 30 minutes.</p>
        </div>
      </Card>
      <Recent prefixes={["voice-only-", "no-voice-"]} title="Latest separations" />
    </div>
  );
}

/** Splits pasted text into chapters ("Chapter …" or "# …" lines) and paragraphs (blank lines). */
function importText(text: string, voice: VoiceChoice): Chapter[] {
  const chapters: Chapter[] = [];
  let cur: Chapter | null = null;
  for (const para of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = para.trim().split("\n");
    const head = lines[0]?.match(/^(?:#+\s*(.+)|((?:chapter|part)\s+[\w.-]+.*))$/i);
    if (head) {
      cur = { id: newId("chp"), title: (head[1] ?? head[2]).trim().slice(0, 80), blocks: [] };
      chapters.push(cur);
      lines.shift();
    }
    const body = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!body) continue;
    if (!cur) {
      cur = { id: newId("chp"), title: "Chapter 1", blocks: [] };
      chapters.push(cur);
    }
    cur.blocks.push({ id: newId("blk"), text: body.slice(0, 5000), voice });
  }
  return chapters;
}

function StudioTab({ info, reload }: { info: Info | null; reload: () => void }) {
  const { toast } = useApp();
  const tool = useRun();
  const [proj, setProj] = useState<Project | null>(null);
  const [voice, setVoice] = useState<VoiceChoice>({ kind: "free", id: "bm_fable", speed: 1 });
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const blank = (): Project => ({ id: "", title: "Untitled audiobook", chapters: [{ id: newId("chp"), title: "Chapter 1", blocks: [{ id: newId("blk"), text: "", voice }] }], updatedAt: "", credits: 0 });
  const credits = useMemo(() => (proj ? proj.chapters.flatMap((c) => c.blocks).reduce((n, b) => n + (stripTags(b.text) ? voiceCost(stripTags(b.text).length, b.voice, info?.credits) : 0), 0) : 0), [proj, info]);
  const set = (fn: (p: Project) => Project) => setProj((p) => (p ? fn(structuredClone(p)) : p));
  async function save(): Promise<Project | null> {
    if (!proj) return null;
    setSaving(true);
    try {
      const r = await api<{ project: Project }>("/api/voice-lab", { body: { action: "project-save", project: proj } });
      // Keep empty paragraphs the person is still writing in; the server drops them.
      setProj({ ...proj, id: r.project.id, renderUrl: proj.renderUrl });
      reload();
      return r.project;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setSaving(false);
    }
  }
  if (!proj) {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader title="Audio Studio" subtitle="Audiobooks, podcasts and long narration: chapters, a voice for every paragraph, one MP3 with chapter markers." icon={<BookAudio className="h-4 w-4" />} action={<Button variant="primary" onClick={() => setProj(blank())}><Plus className="h-4 w-4" /> New project</Button>} />
          <div className="grid gap-3 p-4">
            {!info?.projects.length && <div className="text-sm text-white/50">No projects yet.</div>}
            {info?.projects.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] p-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setProj(p)}>
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="text-xs text-white/50">{p.chapters.length} chapters · {p.chapters.reduce((n, c) => n + c.blocks.length, 0)} paragraphs · {p.credits} credits to render</div>
                </button>
                {p.renderUrl && <audio src={p.renderUrl} controls className="h-8 w-full sm:w-64" />}
                <Button size="sm" variant="ghost" aria-label={`Delete ${p.title}`} onClick={async () => {
                  if (!confirm(`Delete “${p.title}”? The rendered MP3 stays in your Media Library.`)) return;
                  await api("/api/voice-lab", { body: { action: "project-delete", id: p.id } });
                  reload();
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Start from a manuscript" subtitle="Paste your text. Lines starting with “Chapter” or “#” begin chapters; blank lines split paragraphs." />
          <div className="grid gap-3 p-4">
            <Textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"# Chapter One\n\nIt was the summer the river went dry.\n\nNobody in town talked about it."} />
            <Field label="Narrator"><VoicePicker value={voice} onChange={setVoice} languages={info?.languages} compact /></Field>
            <Button disabled={!paste.trim()} onClick={() => {
              const chapters = importText(paste, voice);
              if (!chapters.length) return toast("No text found.", "error");
              setProj({ ...blank(), chapters });
              setPaste("");
            }}>Import</Button>
          </div>
        </Card>
      </div>
    );
  }
  const engineNeeded = proj.chapters.some((c) => c.blocks.some((b) => b.voice.kind === "engine"));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => { setProj(null); reload(); }}>← Projects</Button>
        <Input value={proj.title} maxLength={80} onChange={(e) => set((p) => ({ ...p, title: e.target.value }))} className="min-w-0 flex-1" aria-label="Project title" />
        <Button onClick={save} loading={saving}>Save</Button>
        <Button variant="primary" loading={tool.busy} disabled={!credits || (engineNeeded && info?.engine === false)} onClick={async () => {
          const p = await save();
          if (p) await tool.run({ action: "project-render", id: p.id }, "The MP3 appears in this project and your Media Library.");
        }}>Render MP3 · {credits} credits</Button>
      </div>
      {engineNeeded && <EngineNote info={info} what="A paragraph with an engine voice" />}
      {proj.renderUrl && <Card className="p-3"><audio src={proj.renderUrl} controls className="h-9 w-full" /></Card>}
      {proj.chapters.map((c, ci) => (
        <Card key={c.id} className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
            <Input value={c.title} maxLength={80} onChange={(e) => set((p) => { p.chapters[ci].title = e.target.value; return p; })} className="min-w-0 flex-1 font-medium" aria-label="Chapter title" />
            <Button size="sm" variant="ghost" aria-label="Move chapter up" disabled={!ci} onClick={() => set((p) => { [p.chapters[ci - 1], p.chapters[ci]] = [p.chapters[ci], p.chapters[ci - 1]]; return p; })}><ChevronUp className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Move chapter down" disabled={ci === proj.chapters.length - 1} onClick={() => set((p) => { [p.chapters[ci + 1], p.chapters[ci]] = [p.chapters[ci], p.chapters[ci + 1]]; return p; })}><ChevronDown className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Delete chapter" disabled={proj.chapters.length === 1} onClick={() => set((p) => { p.chapters.splice(ci, 1); return p; })}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="grid gap-3 p-3">
            {c.blocks.map((b, bi) => (
              <div key={b.id} className="grid gap-2 rounded-xl bg-white/[0.03] p-3">
                <Textarea rows={3} value={b.text} maxLength={5000} onChange={(e) => set((p) => { p.chapters[ci].blocks[bi].text = e.target.value; return p; })} placeholder="A paragraph. Emotion tags like [whispers] work here too." />
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1"><VoicePicker value={b.voice} onChange={(v) => set((p) => { p.chapters[ci].blocks[bi].voice = v; return p; })} languages={info?.languages} /></div>
                  <Button size="sm" variant="ghost" aria-label="Delete paragraph" onClick={() => set((p) => { p.chapters[ci].blocks.splice(bi, 1); return p; })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            <Button size="sm" onClick={() => set((p) => { const last = p.chapters[ci].blocks.at(-1)?.voice ?? voice; p.chapters[ci].blocks.push({ id: newId("blk"), text: "", voice: last }); return p; })}><Plus className="h-3.5 w-3.5" /> Paragraph</Button>
          </div>
        </Card>
      ))}
      <Button onClick={() => set((p) => { p.chapters.push({ id: newId("chp"), title: `Chapter ${p.chapters.length + 1}`, blocks: [{ id: newId("blk"), text: "", voice: p.chapters.at(-1)?.blocks.at(-1)?.voice ?? voice }] }); return p; })}><Plus className="h-4 w-4" /> Chapter</Button>
    </div>
  );
}

function VoiceToVideoTab({ info, voice, setVoice, onRecord }: { info: Info | null; voice: VoiceChoice; setVoice: (v: VoiceChoice) => void; onRecord: () => void }) {
  const { items, reload } = useMedia();
  const tool = useRun();
  const [videoId, setVideoId] = useState("");
  const [source, setSource] = useState<"script" | "recording">("script");
  const [text, setText] = useState("");
  const [recId, setRecId] = useState("");
  const [mix, setMix] = useState<"replace" | "duck">("duck");
  const [captions, setCaptions] = useState(true);
  const [lipsync, setLipsync] = useState(false);
  const chars = stripTags(text).length;
  const estimate = (source === "script" ? voiceCost(chars, voice, info?.credits) : 0) + (lipsync && info ? info.credits.lipsyncSecond * Math.max(1, Math.ceil(source === "script" ? chars / 14 : 30)) : 0);
  const needsEngine = lipsync || (source === "script" && voice.kind === "engine");
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="min-w-0">
        <CardHeader title="Voice to video" subtitle="Give any video a voice: type a script, record yourself, or use a recording. Add captions and lip sync." icon={<Video className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <Field label="Video"><MediaSelect items={items} kinds={["video"]} value={videoId} onChange={setVideoId} empty="Upload or make a video first" /></Field>
          <div className="grid grid-cols-2 gap-2">
            {(["script", "recording"] as const).map((k) => (
              <button key={k} onClick={() => setSource(k)} className={cn("rounded-xl border px-3 py-2 text-sm", source === k ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03]")}>{k === "script" ? "Type a script" : "Record or choose audio"}</button>
            ))}
          </div>
          {source === "script" ? (
            <>
              <Textarea rows={5} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What the voice says. Emotion tags like [excited] work here." />
              <VoicePicker value={voice} onChange={setVoice} languages={info?.languages} />
            </>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2"><Recorder onSaved={(id) => { reload(); setRecId(id); }} /><span className="text-xs text-white/50">or choose:</span></div>
              <p className="text-xs text-white/50">Want to talk while the video plays, so your voice lands right on the picture? Use <button onClick={onRecord} className="text-mint-300 underline">Record Voice</button>.</p>
              <MediaSelect items={items} kinds={["audio"]} value={recId} onChange={setRecId} empty="No recordings yet" />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {([["duck", "Keep the video's sound", "Lowered automatically while the voice speaks."], ["replace", "Replace the sound", "Only the new voice."]] as const).map(([k, t, d]) => (
              <button key={k} onClick={() => setMix(k)} className={cn("rounded-xl border p-3 text-left", mix === k ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03]")}>
                <div className="text-sm font-medium">{t}</div>
                <div className="mt-1 text-xs text-white/55">{d}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={captions} onChange={setCaptions} label="Burned-in captions (free)" /> Burned-in captions (free)</label>
            <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={lipsync} onChange={setLipsync} label="Lip sync the face" /> Lip sync the face</label>
          </div>
          {needsEngine && <EngineNote info={info} what={lipsync ? "Lip sync" : "This voice"} />}
          <Button variant="primary" size="lg" loading={tool.busy} disabled={!videoId || (source === "script" ? !chars : !recId) || (needsEngine && info?.engine === false)} onClick={() => tool.run({ action: "voice-to-video", videoId, voice: source === "script" ? { text, choice: voice } : { mediaId: recId }, mix, captions, lipsync })}>
            Make the video · {estimate ? `about ${estimate} credits` : "free"}
          </Button>
          <p className="text-xs text-white/45">If the voice is longer than the video, the picture loops to the end of the voice. Going the other way? <Link href="/studio" className="text-mint-300 underline">Audio to video</Link> in Content Studio makes a whole video from a recording.</p>
        </div>
      </Card>
      <Recent prefixes={["voiced-"]} kind="video" title="Latest voiced videos" />
    </div>
  );
}

function VoiceLab() {
  const params = useSearchParams();
  const initial = TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as Tab) : "record";
  const [tab, setTab] = useState<Tab>(initial);
  // The side menu's Record Voice shortcut links here with ?tab=record: follow it while the page is open too.
  useEffect(() => {
    const t = params.get("tab");
    if (TABS.some((x) => x.id === t)) setTab(t as Tab);
  }, [params]);
  const { info, reload } = useInfo();
  const [voice, setVoice] = useState<VoiceChoice>(DEFAULT_VOICE);
  const [description, setDescription] = useState("");
  const strip = useRef<HTMLDivElement>(null);
  // On a phone the tabs scroll sideways: keep the open one in view.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[data-active=true]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);
  return (
    <>
      <PageHeader title="Voice Lab" subtitle="Record your voice over a video, lifelike speech, voice design, a voice library, transcripts, voice isolation, audiobooks and voice-over for video, all built into Ghost Post. No outside voice service needed." />
      <div ref={strip} className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.id} data-active={tab === t.id} onClick={() => setTab(t.id)} className={cn("flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition", tab === t.id ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "record" && (
        <div className="grid gap-6">
          <RecordVoiceTab engine={info?.engine} lipsyncSecond={info?.credits.lipsyncSecond} />
          <Recent prefixes={["voiced-"]} kind="video" title="Latest voiced videos" />
        </div>
      )}
      {tab === "tts" && <TtsTab info={info} voice={voice} setVoice={setVoice} />}
      {tab === "library" && <LibraryTab onUse={(v) => { setVoice(v); setTab("tts"); }} onDesign={(d) => { setDescription(d); setTab("design"); }} />}
      {tab === "design" && <DesignTab info={info} description={description} setDescription={setDescription} />}
      {tab === "stt" && <SttTab info={info} reload={reload} />}
      {tab === "isolate" && <IsolateTab info={info} />}
      {tab === "studio" && <StudioTab info={info} reload={reload} />}
      {tab === "v2v" && <VoiceToVideoTab info={info} voice={voice} setVoice={setVoice} onRecord={() => setTab("record")} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <VoiceLab />
    </Suspense>
  );
}
