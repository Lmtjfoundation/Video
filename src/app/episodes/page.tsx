"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clapperboard, Cpu, Download, ListVideo, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Badge, Button, Card, CardHeader, Empty, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

type Frame = { id: string; image: string; done: boolean; verdict: string | null };
type Episode = {
  id: string;
  prompt: string;
  length: string;
  aspect: "9:16" | "16:9";
  engine: "gemini" | "own" | null;
  step: string;
  stepLabel: string;
  message: string;
  progress: number;
  error: string | null;
  createdAt: string;
  series: string | null;
  title: string | null;
  logline: string | null;
  seconds: number | null;
  cast: { key: string; name: string; role: string; voice: string; image: string | null }[];
  frames: Frame[];
  shots: number;
  filmed: number;
  videoUrl: string | null;
};
type Data = {
  episodes: Episode[];
  ready: { gemini: boolean; clips: boolean; lipsync: boolean; pictures: boolean; voices: boolean; ffmpeg: boolean; python: boolean };
  lengths: { id: string; label: string; seconds: number; shots: number; credits: number; gpuCredits: number }[];
};
type Gpu = { ready: boolean; queue: number; device: string; quality: string } | null;

const READY_LABEL: Record<keyof Data["ready"], string> = {
  gemini: "4K cinema camera",
  clips: "GPU engine (films in 480p-720p)",
  pictures: "Azure AI pictures (FLUX.2)",
  voices: "Azure neural voices",
  lipsync: "Lip sync (MuseTalk)",
  ffmpeg: "ffmpeg",
  python: "Finishing tools (Python, OpenCV)",
};
/** Not needed on their own: either camera films (Gemini or the GPU), and lip sync is a bonus on the GPU's shots. */
const OPTIONAL = new Set(["lipsync", "gemini", "clips"]);
const running = (e: Episode) => !["done", "failed"].includes(e.step);

export default function EpisodeStudio() {
  const { toast, refresh } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [prompt, setPrompt] = useState("");
  const [length, setLength] = useState("short");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [engine, setEngine] = useState<"gemini" | "own" | null>(null);
  const [busy, setBusy] = useState(false);
  const [gpu, setGpu] = useState<Gpu | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/episodes"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
    const reload = () => load();
    window.addEventListener("ghostpost:job-done", reload);
    return () => window.removeEventListener("ghostpost:job-done", reload);
  }, [load]);
  const anyRunning = !!data?.episodes.some(running);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  const chosen = useMemo(() => data?.lengths.find((l) => l.id === length), [data, length]);
  // The camera: Gemini in 4K when the app has its key, unless the GPU is picked.
  const camera = engine ?? (data?.ready.gemini || !data?.ready.clips ? "gemini" : "own");
  const blockers = data ? [...(Object.keys(data.ready) as (keyof Data["ready"])[]).filter((k) => !data.ready[k] && !OPTIONAL.has(k)), ...(data.ready[camera === "gemini" ? "gemini" : "clips"] ? [] : [camera])] : [];
  const credits = chosen ? (camera === "gemini" ? chosen.credits : chosen.gpuCredits) : 0;
  // Measured while making Second Line episode 1: about 15 minutes of GPU per shot on a T4.
  const perShot = gpu?.device && /T4/i.test(gpu.device) ? 15 : null;

  async function make() {
    setBusy(true);
    try {
      await api("/api/episodes", { body: { action: "create", prompt, length, aspect, engine: camera } });
      jobStarted();
      setPrompt("");
      toast("Episode started. It keeps going if you leave this page; the jobs tray shows each step.", "success");
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function act(action: "resume" | "delete", id: string) {
    try {
      await api("/api/episodes", { body: { action, id } });
      if (action === "resume") jobStarted();
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function checkGpu() {
    setChecking(true);
    try {
      const r = await api<{ gpu: Gpu; error?: string }>("/api/episodes", { body: { action: "gpu" } });
      setGpu(r.gpu);
      if (r.error) toast(r.error, "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Episode Studio"
        subtitle="Type a premise. Vueio writes the episode, casts it, films every shot as moving footage, gives each character an acted voice, scores it, and finishes it in 4K with special effects, transitions, animated titles and captions."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="New episode" icon={<Clapperboard className="h-4 w-4" />} subtitle="Original stories only: no real people, brands or existing shows." />
          <div className="space-y-4 p-5">
            <Field label="Premise" hint="Who, where, and what goes wrong. A sentence or a page.">
              <Textarea
                rows={5}
                maxLength={4000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A New Orleans crime drama: four friends from the 7th Ward turn to the street after a stray bullet hits a cousin at a second line parade, and a crooked detective wants a cut."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Length">
                <Select value={length} onChange={(e) => setLength(e.target.value)}>
                  {(data?.lengths ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Frame">
                <Select value={aspect} onChange={(e) => setAspect(e.target.value as "9:16" | "16:9")}>
                  <option value="9:16">Vertical 9:16 (TikTok, Reels, Shorts)</option>
                  <option value="16:9">Widescreen 16:9 (YouTube)</option>
                </Select>
              </Field>
              <Field label="Camera">
                <Select value={camera} onChange={(e) => setEngine(e.target.value as "gemini" | "own")}>
                  <option value="gemini" disabled={!!data && !data.ready.gemini}>
                    Cinema camera · 4K{data && !data.ready.gemini ? " (not set up)" : ""}
                  </option>
                  <option value="own" disabled={!!data && !data.ready.clips}>
                    Vueio GPU · upscaled to 4K{data && !data.ready.clips ? " (not connected)" : ""}
                  </option>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-white/50">
                {chosen ? `4K · up to ${chosen.shots} shots · ${credits.toLocaleString()} credits (refunded if it stops)` : ""}
                {camera === "own" && perShot && chosen ? ` · about ${Math.round((chosen.shots * perShot) / 60)} hours on this GPU` : ""}
              </p>
              <Button variant="primary" size="lg" loading={busy} disabled={prompt.trim().length < 12 || blockers.length > 0} onClick={make}>
                <ListVideo className="h-4 w-4" /> Make the episode
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="This server"
            icon={<Cpu className="h-4 w-4" />}
            action={
              <Button size="sm" loading={checking} onClick={checkGpu} title="Asks the GPU for its queue and speed (starts it if it's asleep)">
                Check GPU
              </Button>
            }
          />
          <ul className="space-y-2 p-5 text-sm">
            {data &&
              (Object.keys(READY_LABEL) as (keyof Data["ready"])[]).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  {data.ready[k] ? <CheckCircle2 className="h-4 w-4 text-mint-300" /> : <XCircle className={cn("h-4 w-4", OPTIONAL.has(k) ? "text-white/50" : "text-red-300")} />}
                  <span className={data.ready[k] ? "text-white/80" : "text-white/50"}>
                    {READY_LABEL[k]}
                    {!data.ready[k] && k === "lipsync" ? " (optional: lips aren't synced without it)" : ""}
                    {!data.ready[k] && k === "gemini" ? " (the admin turns it on in Admin → App settings → Integrations)" : ""}
                  </span>
                </li>
              ))}
            {gpu !== undefined && (
              <li className="pt-2 text-xs text-white/60">
                {gpu ? `GPU: ${gpu.device || "unknown"} · ${gpu.quality || "?"} quality · ${gpu.ready ? `${gpu.queue} clip${gpu.queue === 1 ? "" : "s"} waiting` : "loading its models"}` : "The GPU engine didn't answer."}
                {gpu && /T4/i.test(gpu.device) ? " · A T4 films about one shot every 15 minutes at 480p; an 80 GB GPU films in 720p, much faster." : ""}
              </li>
            )}
          </ul>
        </Card>
      </div>

      <div className="mt-6 space-y-5">
        {data && !data.episodes.length && <Empty icon={<ListVideo className="h-6 w-6" />} title="No episodes yet" body="Your episodes appear here, step by step, while they're made." />}
        {data?.episodes.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{e.series && e.title ? `${e.series}: ${e.title}` : e.prompt.slice(0, 80)}</p>
                {e.logline && <p className="mt-0.5 text-sm text-white/60">{e.logline}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={e.step === "done" ? "mint" : e.step === "failed" ? "red" : "sky"}>{e.stepLabel}</Badge>
                <Badge>{e.aspect}</Badge>
                {e.engine === "gemini" && <Badge tone="sky">4K cinema camera</Badge>}
                {e.step === "failed" && (
                  <Button size="sm" onClick={() => act("resume", e.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Resume
                  </Button>
                )}
                {!running(e) && (
                  <Button size="sm" variant="ghost" onClick={() => confirm("Delete this episode and its files?") && act("delete", e.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-4 p-5">
              {running(e) && (
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-white/60">
                    <span>{e.message}</span>
                    <span>{e.progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-mint-400 transition-all" style={{ width: `${e.progress}%` }} />
                  </div>
                </div>
              )}
              {e.step === "failed" && e.error && <p className="text-sm text-red-300">{e.error}</p>}
              {e.videoUrl && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <video src={e.videoUrl} controls playsInline className={cn("rounded-xl bg-black", e.aspect === "9:16" ? "max-h-[70vh] w-full max-w-[360px]" : "w-full max-w-3xl")} />
                  <div className="space-y-2 text-sm text-white/70">
                    <p>{e.message}</p>
                    <a href={e.videoUrl} download className="inline-flex items-center gap-1.5 text-mint-300 hover:underline">
                      <Download className="h-4 w-4" /> Download the MP4
                    </a>
                    <p className="text-xs text-white/50">Also saved in My Media.</p>
                  </div>
                </div>
              )}
              {!!e.cast.length && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/55">Cast</p>
                  <div className="flex flex-wrap gap-3">
                    {e.cast.map((c) => (
                      <div key={c.key} className="w-24 text-center">
                        <div className="aspect-square overflow-hidden rounded-lg bg-white/[0.04]">{c.image && <img src={c.image} alt={c.name} className="h-full w-full object-cover" />}</div>
                        <p className="mt-1 truncate text-xs text-white/80">{c.name}</p>
                        <p className="truncate text-[10px] text-white/55">{c.role}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!!e.frames.length && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/55">
                    Shots · {e.filmed} of {e.shots} filmed
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {e.frames.map((f) => (
                      <div key={f.id} className={cn("relative shrink-0 overflow-hidden rounded-md bg-white/[0.04]", e.aspect === "9:16" ? "h-28 w-16" : "h-16 w-28")}>
                        <img src={f.image} alt={f.id} className={cn("h-full w-full object-cover", !f.done && "opacity-50")} />
                        {f.done && <CheckCircle2 className="absolute right-0.5 top-0.5 h-3.5 w-3.5 text-mint-300" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
