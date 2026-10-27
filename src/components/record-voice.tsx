"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Circle, Headphones, Mic, Pause, Play, Square, Trash2, Upload } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { cn } from "@/lib/utils";
import { Button, Card, CardHeader, Field, Label, Select, Switch } from "@/components/ui";
import { MediaSelect, useMedia } from "@/components/voice-tools";

type Take = { id: string; blob: Blob; url: string; offset: number; secs: number; type: string };
const MAX_TAKES = 5;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
const recorderType = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";

async function uploadMedia(file: File) {
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch("/api/media", { method: "POST", body: fd });
  const j = (await res.json().catch(() => ({}))) as { saved?: { id: string }[]; errors?: string[]; error?: string };
  if (!j.saved?.[0]) throw new Error(j.error || j.errors?.[0] || "The upload didn't go through. Try again.");
  return j.saved[0].id;
}

/**
 * Record Voice: the video plays while you talk, so your voice lands exactly where you said it. Keep the best take,
 * then Ghost Post puts it in the video (cleaned up, with captions, over or instead of the original sound).
 */
export function RecordVoiceTab({ engine, lipsyncSecond }: { engine: boolean | undefined; lipsyncSecond?: number }) {
  const { toast, refresh } = useApp();
  const { items, reload } = useMedia();
  const [videoId, setVideoId] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const [length, setLength] = useState(0);
  const [uploading, setUploading] = useState(false);

  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<HTMLDivElement>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const [micOn, setMicOn] = useState(false);
  const [videoSound, setVideoSound] = useState<"off" | "quiet">("off");

  const [count, setCount] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const recStart = useRef(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [chosen, setChosen] = useState("");
  const [playing, setPlaying] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);

  const [mix, setMix] = useState<"duck" | "replace">("duck");
  const [cleanup, setCleanup] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [lipsync, setLipsync] = useState(false);
  const [busy, setBusy] = useState(false);

  const src = items.find((m) => m.id === videoId)?.url;
  const take = takes.find((t) => t.id === chosen);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setMicOn(false);
  }, []);

  /** Opens the microphone (noise suppression and echo cancellation on) and drives the level meter. */
  const openMic = useCallback(async (id = micId) => {
    stopMic();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.current = s;
      setMicOn(true);
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      setMics(list);
      if (!id) setMicId(s.getAudioTracks()[0]?.getSettings().deviceId ?? "");
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        // dBFS to 0–100%, from −60 dB (silence) to 0 dB (clipping).
        const pct = Math.max(0, Math.min(100, ((20 * Math.log10(peak || 1e-6) + 60) / 60) * 100));
        if (meter.current) {
          meter.current.style.width = `${pct}%`;
          meter.current.style.background = pct > 92 ? "#f87171" : pct > 75 ? "#facc15" : "#5eead4";
        }
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      return s;
    } catch {
      toast("The microphone isn't available. Allow it in your browser's address bar, then try again.", "error");
      return null;
    }
  }, [micId, stopMic, toast]);

  useEffect(() => () => {
    stopMic();
    if (recorder.current?.state === "recording") recorder.current.stop();
    player.current?.pause();
  }, [stopMic]);

  // Takes belong to one video: a new video starts fresh.
  useEffect(() => {
    setTakes((ts) => {
      ts.forEach((t) => URL.revokeObjectURL(t.url));
      return [];
    });
    setChosen("");
    setPlayhead(0);
  }, [videoId]);

  /** Recording and take playback lower or mute the video; it plays at full sound again afterwards. */
  const unmute = () => {
    if (video.current) {
      video.current.muted = false;
      video.current.volume = 1;
    }
  };
  const stopPlayback = () => {
    player.current?.pause();
    player.current = null;
    video.current?.pause();
    unmute();
    setPlaying("");
  };

  async function record() {
    const v = video.current;
    if (!v) return;
    if (takes.length >= MAX_TAKES) return toast(`Up to ${MAX_TAKES} takes. Delete one to record another.`, "error");
    stopPlayback();
    const s = stream.current ?? (await openMic());
    if (!s) return;
    const type = recorderType();
    if (!type) return toast("This browser can't record audio. Try Chrome, Edge, Firefox or Safari.", "error");
    // Start where the playhead is; at the very end, start over from the beginning.
    const offset = v.duration && v.currentTime >= v.duration - 0.25 ? 0 : v.currentTime;
    v.currentTime = offset;
    for (let n = 3; n > 0; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCount(0);
    const parts: Blob[] = [];
    const r = new MediaRecorder(s, { mimeType: type });
    r.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };
    r.onstop = () => {
      v.pause();
      unmute();
      setRecording(false);
      const secs = (performance.now() - recStart.current) / 1000;
      if (secs < 0.5) return toast("That take was too short. Press Record and speak.", "error");
      const blob = new Blob(parts, { type: type.split(";")[0] });
      const t: Take = { id: `take_${Date.now()}`, blob, url: URL.createObjectURL(blob), offset, secs, type: type.split(";")[0] };
      setTakes((ts) => [...ts, t]);
      setChosen(t.id);
    };
    recorder.current = r;
    v.muted = videoSound === "off";
    v.volume = 0.25;
    r.start(250);
    recStart.current = performance.now();
    setRecording(true);
    await v.play().catch(() => {});
  }

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  /** Plays the video from the take's start with the take over it, the way the finished video will sound. */
  async function playTake(t: Take) {
    if (playing === t.id) return stopPlayback();
    stopPlayback();
    const v = video.current;
    if (!v) return;
    v.currentTime = t.offset;
    v.muted = mix === "replace";
    v.volume = 0.2;
    const a = new Audio(t.url);
    player.current = a;
    a.onended = stopPlayback;
    setPlaying(t.id);
    await Promise.all([v.play().catch(() => {}), a.play().catch(() => {})]);
  }

  function remove(t: Take) {
    if (playing === t.id) stopPlayback();
    URL.revokeObjectURL(t.url);
    setTakes((ts) => ts.filter((x) => x.id !== t.id));
    if (chosen === t.id) setChosen("");
  }

  async function uploadVideo(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try {
      const id = await uploadMedia(f);
      await reload();
      setVideoId(id);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function finish() {
    if (!take) return;
    setBusy(true);
    try {
      const ext = take.type === "audio/mp4" ? "m4a" : "webm";
      const mediaId = await uploadMedia(new File([take.blob], `voice-take-${Date.now()}.${ext}`, { type: take.type }));
      const r = await api<{ credits: number }>("/api/voice-lab", {
        body: { action: "voice-to-video", videoId, voice: { mediaId }, offset: Math.round(take.offset * 100) / 100, cleanup, mix, captions, lipsync },
      });
      jobStarted();
      toast(`Started${r.credits ? ` (${r.credits} credits)` : " (free)"}. Your voiced video is saved to your Media Library when it's ready.`, "success");
      refresh();
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const lipCost = lipsync && lipsyncSecond && take ? lipsyncSecond * Math.max(1, Math.ceil(take.secs)) : 0;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="min-w-0">
        <CardHeader title="Record your voice over a video" subtitle="The video plays while you talk, so your voice lands exactly where you say it. Record a few takes, keep the best one." icon={<Mic className="h-4 w-4" />} />
        <div className="grid grid-cols-1 gap-4 p-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="Video"><MediaSelect items={items} kinds={["video"]} value={videoId} onChange={setVideoId} empty="Upload a video first" /></Field>
            <label className={cn("inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-white/90 hover:bg-white/[0.08]", uploading && "pointer-events-none opacity-50")}>
              <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload a video"}
              <input type="file" accept="video/*" className="sr-only" onChange={(e) => uploadVideo(e.target.files?.[0])} />
            </label>
          </div>

          <div className="relative overflow-hidden rounded-xl bg-black">
            {src ? (
              <video
                ref={video}
                key={src}
                src={src}
                playsInline
                controls={!recording && !count}
                className="mx-auto max-h-[52vh] w-full"
                onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
                onEnded={() => (recording ? stop() : setPlaying(""))}
              />
            ) : (
              <div className="grid grid-cols-1 aspect-video place-items-center p-6 text-center text-sm text-white/45">Choose or upload a video to record over.</div>
            )}
            {count > 0 && <div className="absolute inset-0 grid grid-cols-1 place-items-center bg-black/55 text-7xl font-bold text-white" aria-live="assertive">{count}</div>}
            {recording && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold text-white">
                <Circle className="h-2.5 w-2.5 animate-pulse fill-white" /> REC {clock(playhead)}
              </div>
            )}
          </div>
          {src && <div className="text-xs text-white/50">Recording starts at the playhead: <span className="font-mono text-white/80">{clock(playhead)}</span>{length ? ` of ${clock(length)}` : ""}. Move it with the video&apos;s controls to add a line in the middle.</div>}

          <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {micOn && mics.length ? (
                <Field label="Microphone">
                  <Select value={micId} onChange={(e) => { setMicId(e.target.value); openMic(e.target.value); }}>
                    {mics.map((m, i) => <option key={m.deviceId || i} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
                  </Select>
                </Field>
              ) : (
                // A button can't sit inside Field's <label>: the label would become its name.
                <div>
                  <Label>Microphone</Label>
                  <Button onClick={() => openMic()} className="w-full"><Mic className="h-4 w-4" /> Turn on the microphone</Button>
                </div>
              )}
              <Field label="Video sound while recording">
                <Select value={videoSound} onChange={(e) => setVideoSound(e.target.value as "off" | "quiet")}>
                  <option value="off">Off (best without headphones)</option>
                  <option value="quiet">Quiet (use headphones)</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-1">
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10"><div ref={meter} className="h-full w-0 rounded-full transition-[width] duration-75" /></div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/45"><Headphones className="h-3.5 w-3.5" /> {micOn ? "Speak at your normal level: the bar should reach the yellow on loud words, never the red." : "Turn on the microphone to see your level."}</div>
            </div>
            {recording ? (
              <Button variant="danger" size="lg" onClick={stop}><Square className="h-4 w-4" /> Stop recording</Button>
            ) : (
              <Button variant="primary" size="lg" disabled={!src || count > 0} onClick={record}><Circle className="h-4 w-4 fill-current" /> {count ? `Starting in ${count}…` : takes.length ? "Record another take" : "Record"}</Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 content-start gap-6">
        <Card>
          <CardHeader title="Takes" subtitle={takes.length ? `Choose the one to use. Up to ${MAX_TAKES}.` : "Your recordings appear here."} />
          <div className="grid grid-cols-1 gap-2 p-4">
            {!takes.length && <div className="text-sm text-white/45">No takes yet. Press Record, wait for 3-2-1, then talk.</div>}
            {takes.map((t, i) => (
              <div key={t.id} className={cn("flex items-center gap-2 rounded-xl border p-2.5", chosen === t.id ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03]")}>
                <button onClick={() => setChosen(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-pressed={chosen === t.id}>
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", chosen === t.id ? "border-mint-400 bg-mint-400 text-ink-950" : "border-white/25")}>{chosen === t.id && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Take {i + 1}</span>
                    <span className="block text-xs text-white/50">{t.secs.toFixed(1)}s, from {clock(t.offset)}</span>
                  </span>
                </button>
                <Button size="icon" variant="ghost" title="Play with the video" aria-label={`Play take ${i + 1} with the video`} onClick={() => playTake(t)}>{playing === t.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                <Button size="icon" variant="ghost" title="Delete" aria-label={`Delete take ${i + 1}`} onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Put it in the video" />
          <div className="grid grid-cols-1 gap-4 p-4">
            <div className="grid grid-cols-1 gap-2">
              {([["duck", "Keep the video's sound", "Lowered automatically under your voice."], ["replace", "Replace the sound", "Only your voice."]] as const).map(([k, t, d]) => (
                <button key={k} onClick={() => setMix(k)} className={cn("rounded-xl border p-3 text-left", mix === k ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03]")}>
                  <div className="text-sm font-medium">{t}</div>
                  <div className="mt-1 text-xs text-white/55">{d}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={cleanup} onChange={setCleanup} label="Clean up my voice: less hiss and rumble, even level (free)" /> Clean up my voice: less hiss and rumble, even level (free)</label>
              <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={captions} onChange={setCaptions} label="Burned-in captions (free)" /> Burned-in captions (free)</label>
              <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={lipsync && engine === true} disabled={engine !== true} onChange={(v) => setLipsync(v && engine === true)} label="Lip sync the face" /> Lip sync the face</label>
            </div>
            {engine === false && <div className="rounded-xl border border-gold-300/30 bg-gold-300/10 p-3 text-xs text-white/75">Lip sync needs Ghost Post&apos;s engine with a GPU, which isn&apos;t connected yet. Everything else here works now.</div>}
            <Button variant="primary" size="lg" loading={busy} disabled={!take || !videoId || recording} onClick={finish}>
              Put my voice in the video · {lipCost ? `about ${lipCost} credits` : "free"}
            </Button>
            <p className="text-xs text-white/45">Your voice starts exactly where you recorded it. If it runs past the end, the picture loops to the end of your voice.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
