"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Clapperboard, Mic, Music2, Sparkles } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { cn } from "@/lib/utils";
import { Button, Card, CardHeader, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { MediaSelect, useMedia } from "@/components/voice-tools";

type Tab = "smart" | "music" | "edit";
type Task = "restyle" | "relight" | "motion" | "background" | "inpaint";
type Info = { engine: boolean; credits: { image: number; second: number; editSecond: number } };
type Quote = { seconds: number; bpm: number; shots: number; cuts: number[]; credits: { pictures: number; clips: number } };

const TASKS: { id: Task; name: string; text: string; placeholder: string }[] = [
  { id: "restyle", name: "Restyle", text: "Same motion and framing, a whole new look.", placeholder: "e.g. hand-painted anime, soft watercolor skies" },
  { id: "relight", name: "Relight", text: "Change the light and time of day of a clip.", placeholder: "e.g. golden hour, warm low sun from the left" },
  { id: "motion", name: "Motion control", text: "Your picture's person performs the motion from the clip.", placeholder: "e.g. a woman in a red dress dancing on a rooftop" },
  { id: "background", name: "New background", text: "Keep the person, replace everything behind them.", placeholder: "e.g. a neon-lit Tokyo street at night in the rain" },
  { id: "inpaint", name: "Inpaint", text: "Draw a box and describe what should be there instead.", placeholder: "e.g. an empty sidewalk (removes the man)" },
];
const ASPECTS = [["9:16", "9:16 (tall)"], ["16:9", "16:9 (wide)"], ["1:1", "1:1"]] as const;

function useRun() {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await api<{ credits: number }>("/api/video-tools", { body });
      jobStarted();
      toast(`Started (${r.credits} credits). The tray shows each step; the video lands in your Media Library.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

function EngineNote({ info }: { info: Info | null }) {
  if (!info || info.engine) return null;
  return <div className="rounded-xl border border-gold-300/30 bg-gold-300/10 p-3 text-xs text-white/75">These tools run on Ghost Post&apos;s engine (a GPU), which isn&apos;t connected yet. The admin connects it in Admin → App settings → Integrations.</div>;
}

function Recent({ prefixes }: { prefixes: string[] }) {
  const { items } = useMedia();
  const list = items.filter((m) => m.kind === "video" && prefixes.some((p) => m.name.startsWith(p))).slice(0, 3);
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader title="Latest" subtitle="Also in your Media Library." />
      <div className="grid gap-3 p-4">
        {list.map((m) => (
          <div key={m.id} className="grid gap-1">
            <div className="truncate text-xs text-white/60">{m.name}</div>
            <video src={m.url} controls playsInline className="max-h-96 w-full rounded-lg bg-black" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SmartShot({ info }: { info: Info | null }) {
  const { items } = useMedia();
  const tool = useRun();
  const [prompt, setPrompt] = useState("");
  const [shots, setShots] = useState(4);
  const [secs, setSecs] = useState(4);
  const [aspect, setAspect] = useState("9:16");
  const [imageId, setImageId] = useState("");
  const credits = info ? info.credits.image * (shots - 1 + (imageId ? 0 : 1)) + info.credits.second * secs * shots : 0;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="min-w-0">
        <CardHeader title="Smart Shot" subtitle="One moment, filmed like a real crew would: a wide, a medium, a close-up and more, cut together as one scene." icon={<Clapperboard className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <Field label="The moment"><Textarea rows={4} value={prompt} maxLength={1500} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A tired nurse walks out of the hospital at dawn and finally smiles as the sun hits her face" /></Field>
          <Field label="Start from a picture" hint="optional: its people and place stay the same in every shot"><MediaSelect items={items} kinds={["image"]} value={imageId} onChange={setImageId} empty="No pictures yet" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Shots"><Select value={shots} onChange={(e) => setShots(Number(e.target.value))}>{[3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            <Field label="Each shot"><Select value={secs} onChange={(e) => setSecs(Number(e.target.value))}>{[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} s</option>)}</Select></Field>
            <Field label="Shape"><Select value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          </div>
          <EngineNote info={info} />
          <Button variant="primary" size="lg" loading={tool.busy} disabled={!prompt.trim() || info?.engine === false} onClick={() => tool.run({ action: "smart-shot", prompt, shots, secondsPerShot: secs, aspect, imageId: imageId || undefined })}>
            Film it · {credits} credits
          </Button>
        </div>
      </Card>
      <Recent prefixes={["smart-shot-"]} />
    </div>
  );
}

function MusicVideo({ info }: { info: Info | null }) {
  const { toast } = useApp();
  const { items } = useMedia();
  const tool = useRun();
  const [audioId, setAudioId] = useState("");
  const [idea, setIdea] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [motion, setMotion] = useState<"pictures" | "clips">("pictures");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    setQuote(null);
    if (!audioId) return;
    setChecking(true);
    api<Quote>("/api/video-tools", { body: { action: "quote-music", audioId } })
      .then(setQuote)
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => setChecking(false));
  }, [audioId, toast]);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="min-w-0">
        <CardHeader title="Music video" subtitle="Ghost Post finds the beat and cuts on it: a new shot every bar or two, in one look, over your song." icon={<Music2 className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <Field label="Song"><MediaSelect items={items} kinds={["audio"]} value={audioId} onChange={setAudioId} empty="Upload a song or make one in AI Studio" /></Field>
          {checking && <p className="text-xs text-white/50">Finding the beat…</p>}
          {quote && <p className="text-xs text-white/60">{Math.round(quote.seconds)} s at about {quote.bpm} BPM: {quote.shots} shots, cut on the beat.</p>}
          <Field label="Look and story"><Textarea rows={4} value={idea} maxLength={1500} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. A lonely astronaut on a pink desert planet, retro 80s film look, teal and magenta" /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["pictures", "Pictures in motion", "Stills with slow camera moves. Fast and affordable."], ["clips", "Filmed clips", "Every shot filmed by the engine. Real motion, more credits."]] as const).map(([k, t, d]) => (
              <button key={k} onClick={() => setMotion(k)} className={cn("rounded-xl border p-3 text-left", motion === k ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03]")}>
                <div className="text-sm font-medium">{t}{quote ? ` · ${quote.credits[k]} credits` : ""}</div>
                <div className="mt-1 text-xs text-white/55">{d}</div>
              </button>
            ))}
          </div>
          <Field label="Shape"><Select value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <EngineNote info={info} />
          <Button variant="primary" size="lg" loading={tool.busy} disabled={!quote || !idea.trim() || info?.engine === false} onClick={() => tool.run({ action: "music-video", audioId, idea, aspect, motion })}>
            Make the music video{quote ? ` · ${quote.credits[motion]} credits` : ""}
          </Button>
        </div>
      </Card>
      <Recent prefixes={["music-video-"]} />
    </div>
  );
}

/** Draw a rectangle over the video's first frame; reports it as fractions of the frame. */
function BoxPicker({ url, box, onBox }: { url: string; box: number[] | null; onBox: (b: number[]) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as [number, number];
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const [x, y] = at(e);
    const [x0, y0] = start.current;
    onBox([Math.min(x, x0), Math.min(y, y0), Math.abs(x - x0), Math.abs(y - y0)]);
  };
  return (
    <div ref={area} className="relative mx-auto w-fit touch-none select-none overflow-hidden rounded-lg" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); start.current = at(e); onBox([...start.current, 0, 0]); }} onPointerMove={move} onPointerUp={() => (start.current = null)}>
      {/* "#t=0.1" makes browsers paint the first frame without playing. */}
      <video src={`${url}#t=0.1`} muted playsInline preload="auto" className="block max-h-80 max-w-full" />
      {box && <div className="pointer-events-none absolute border-2 border-mint-300 bg-mint-300/20" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }} />}
    </div>
  );
}

function VideoEdit({ info }: { info: Info | null }) {
  const { items } = useMedia();
  const tool = useRun();
  const [task, setTask] = useState<Task>("restyle");
  const [videoId, setVideoId] = useState("");
  const [imageId, setImageId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [box, setBox] = useState<number[] | null>(null);
  const t = TASKS.find((x) => x.id === task)!;
  const video = items.find((m) => m.id === videoId);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="min-w-0">
        <CardHeader title="Video edits" subtitle="Change a clip after it's filmed: up to its first 5 seconds, with its own sound kept." icon={<Sparkles className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {TASKS.map((x) => (
              <button key={x.id} onClick={() => { setTask(x.id); setBox(null); }} className={cn("rounded-lg px-2 py-2 text-xs font-semibold ring-1", task === x.id ? "bg-mint-400/15 text-mint-200 ring-mint-400/40" : "bg-white/[0.03] text-white/60 ring-white/10")}>{x.name}</button>
            ))}
          </div>
          <p className="-mt-1 text-xs text-white/55">{t.text}</p>
          <Field label={task === "motion" ? "The clip with the motion" : "The clip"}><MediaSelect items={items} kinds={["video"]} value={videoId} onChange={(v) => { setVideoId(v); setBox(null); }} empty="Upload or make a video first" /></Field>
          {task === "inpaint" && video && (
            <Field label="Drag a box over what should change"><BoxPicker url={video.url} box={box} onBox={setBox} /></Field>
          )}
          {(task === "motion" || task === "background") && (
            <Field label={task === "motion" ? "Who performs it" : "Look reference"} hint={task === "motion" ? "a picture of the person or character" : "optional"}>
              <MediaSelect items={items} kinds={["image"]} value={imageId} onChange={setImageId} empty="No pictures yet" />
            </Field>
          )}
          <Field label="The result"><Textarea rows={3} value={prompt} maxLength={1500} onChange={(e) => setPrompt(e.target.value)} placeholder={t.placeholder} /></Field>
          <EngineNote info={info} />
          <Button variant="primary" size="lg" loading={tool.busy} disabled={!videoId || !prompt.trim() || (task === "motion" && !imageId) || (task === "inpaint" && (!box || box[2] < 0.02 || box[3] < 0.02)) || info?.engine === false} onClick={() => tool.run({ action: "edit", task, videoId, prompt, imageId: imageId || undefined, box: box ?? undefined })}>
            {t.name} · up to {info ? info.credits.editSecond * 5 : 80} credits
          </Button>
          <p className="text-xs text-white/45">{info?.credits.editSecond ?? 16} credits per second of clip, up to 5 seconds.</p>
        </div>
      </Card>
      <Recent prefixes={["edit-"]} />
    </div>
  );
}

function VideoTools() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((["smart", "music", "edit"] as Tab[]).includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "smart");
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    api<Info>("/api/video-tools").then(setInfo).catch(() => {});
  }, []);
  return (
    <>
      <PageHeader title="Video Tools" subtitle="Multi-camera Smart Shots, beat-cut music videos, and edits to clips you already have: restyle, relight, motion control, new backgrounds and inpainting." actions={<Link href="/voice-lab?tab=record"><Button><Mic className="h-4 w-4" /> Record your voice over a video</Button></Link>} />
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {([["smart", "Smart Shot", Clapperboard], ["music", "Music Video", Music2], ["edit", "Video Edits", Sparkles]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={cn("flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition", tab === id ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "smart" && <SmartShot info={info} />}
      {tab === "music" && <MusicVideo info={info} />}
      {tab === "edit" && <VideoEdit info={info} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <VideoTools />
    </Suspense>
  );
}
