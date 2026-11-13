"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Film, FlaskConical, Sparkles, UserRound } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { cn } from "@/lib/utils";
import { Button, Card, CardHeader, Field, PageHeader, Select, Switch, Textarea } from "@/components/ui";
import { MediaSelect, useMedia } from "@/components/voice-tools";
import { MOVE_LABELS, movieCredits, type Grade, type MoviePlan, type Move } from "@/lib/movie-maker";

type Info = {
  styles: Record<string, string>;
  lengths: Record<string, number>;
  characters: { id: string; name: string; imageUrl: string }[];
  ready: { pictures: string | null; engine: boolean };
  longCredits: Record<string, { voice: number; silent: number }>;
};

/** Filming runs at about 8 times the video's length on the server's processors. */
const filmTime = (sec: number) => {
  const m = Math.ceil((sec * 8.5) / 60);
  return m < 90 ? `about ${m} minutes` : `about ${Math.round(m / 60)} hours`;
};
type Movies = { movies: { id: string; title: string; seconds: number; videoUrl: string; createdAt: string }[]; cost: { aiImage: number; speech: number } };

const IDEAS = [
  "A second line parade rolls through the Treme at sunset; one brass player carries a secret.",
  "60-second ad for a neighborhood food pantry: from empty shelves to a full community table.",
  "A ghost story told in an old New Orleans hotel hallway, one flickering light at a time.",
];

/**
 * Video Lab: describe a video, the AI writes the shots, one tap films them. Pictures come from Azure's GPUs (or the
 * app's picture maker), the motion engine moves the camera through each one with depth and effects, then voice, music
 * and grade. No GPU server needed.
 */
export default function VideoLab() {
  const { toast, refresh } = useApp();
  const { items } = useMedia();
  const [info, setInfo] = useState<Info | null>(null);
  const [movies, setMovies] = useState<Movies | null>(null);
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState("cinematic");
  const [length, setLength] = useState("s30");
  const [cast, setCast] = useState<string[]>([]);
  const [voice, setVoice] = useState(true);
  const [music, setMusic] = useState("");
  const [plan, setPlan] = useState<MoviePlan | null>(null);
  const [grade, setGrade] = useState<Grade>("teal_orange");
  const [busy, setBusy] = useState<"" | "plan" | "film">("");

  const loadMovies = useCallback(() => api<Movies>("/api/movie-maker").then(setMovies).catch(() => {}), []);
  useEffect(() => {
    api<Info>("/api/video-lab").then(setInfo).catch((e) => toast((e as Error).message, "error"));
    loadMovies();
  }, [toast, loadMovies]);

  const credits = useMemo(() => (plan && movies ? movieCredits(plan, movies.cost, voice) : 0), [plan, movies, voice]);
  const seconds = info?.lengths[length] ?? 30;
  const long = seconds > 90;
  const longCost = info?.longCredits[length]?.[voice ? "voice" : "silent"] ?? 0;

  async function filmLong() {
    setBusy("film");
    try {
      await api("/api/video-lab", { body: { action: "long", idea, length, style, characterIds: cast, voice, musicMediaId: music || undefined } });
      jobStarted();
      toast(`Writing and filming your ${seconds >= 3600 ? `${(seconds / 3600).toFixed(seconds % 3600 ? 1 : 0)}-hour` : `${seconds / 60}-minute`} video, chapter by chapter. You can close the app; you'll get a notification when it's ready.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }
  const offline = info && (!info.ready.pictures || !info.ready.engine);

  async function write() {
    setBusy("plan");
    try {
      const r = await api<{ plan: MoviePlan; grade: Grade }>("/api/video-lab", { body: { action: "plan", idea, length, style, characterIds: cast } });
      setPlan(r.plan);
      setGrade(r.grade);
      toast(`${r.plan.scenes.length} shots written. Change any line, then film it.`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }

  async function film() {
    if (!plan) return;
    setBusy("film");
    try {
      await api("/api/movie-maker", { body: { action: "render", plan, grade, characterIds: cast, voice, musicMediaId: music || undefined, endCard: "", fiction: style !== "documentary" && style !== "ad" } });
      jobStarted();
      toast("Filming your video. You can close the app; you'll get a notification when it's ready.", "success");
      refresh();
      setTimeout(loadMovies, 4000);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }

  const setShot = (i: number, patch: Partial<MoviePlan["scenes"][number]>) => setPlan((p) => (p ? { ...p, scenes: p.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : p));

  return (
    <>
      <PageHeader title="Video Lab" subtitle="Describe a video, from 15 seconds to 1 hour 30 minutes. The AI writes every shot, then films it with real camera moves, depth, effects, voice and music. No GPU needed." />
      {offline && (
        <div className="mb-5 rounded-xl border border-gold-300/30 bg-gold-300/10 p-3 text-sm text-white/80">
          {!info?.ready.pictures ? "Pictures aren't switched on yet. The admin connects Azure AI in Admin → App settings → Integrations." : "The motion engine isn't installed on this server yet."}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="1. Your idea" subtitle="A sentence or two is enough: who, where, what happens." icon={<FlaskConical className="h-4 w-4" />} />
            <div className="grid grid-cols-1 gap-4 p-5">
              <Textarea rows={4} maxLength={2000} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Four friends in New Orleans chase one last deal before Mardi Gras…" aria-label="Your idea" />
              <div className="flex flex-wrap gap-2">
                {IDEAS.map((t) => (
                  <button key={t} onClick={() => setIdea(t)} className="focus-ring rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/65 hover:text-white">{t.slice(0, 48)}…</button>
                ))}
              </div>
              <Field label="Look">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(info?.styles ?? { cinematic: "Cinematic film" }).map(([k, v]) => (
                    <button key={k} onClick={() => setStyle(k)} className={cn("focus-ring rounded-xl border px-3 py-2 text-sm", style === k ? "border-mint-400 bg-mint-400/10 text-white" : "border-white/10 bg-white/[0.03] text-white/70")}>{v}</button>
                  ))}
                </div>
              </Field>
              <Field label="Length">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(info?.lengths ?? { s30: 30 }).map(([k, s]) => (
                    <button key={k} onClick={() => setLength(k)} className={cn("focus-ring rounded-xl border px-3 py-2 text-sm tabular-nums", length === k ? "border-mint-400 bg-mint-400/10 text-white" : "border-white/10 bg-white/[0.03] text-white/70")}>{s < 60 ? `${s} sec` : s >= 3600 ? `${Math.floor(s / 3600)} h${s % 3600 ? ` ${(s % 3600) / 60} min` : ""}` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`}</button>
                  ))}
                </div>
              </Field>
              {!!info?.characters.length && (
                <Field label="Cast (their faces stay the same in every shot)">
                  <div className="flex flex-wrap gap-2">
                    {info.characters.map((c) => {
                      const on = cast.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => setCast((x) => (on ? x.filter((y) => y !== c.id) : [...x, c.id].slice(0, 3)))} aria-pressed={on} className={cn("focus-ring flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm", on ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03] text-white/70")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.imageUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
              {long ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={voice} onChange={setVoice} label="Voice reads the words" /> Voice reads the words</label>
                    <MediaSelect items={items} kinds={["audio"]} value={music} onChange={setMusic} empty="No music (a score is drawn under the voice)" />
                  </div>
                  <Button variant="primary" size="lg" loading={busy === "film"} disabled={idea.trim().length < 8 || !!offline} onClick={filmLong}>
                    <Film className="h-4 w-4" /> Write &amp; film it{longCost ? ` · about ${longCost.toLocaleString()} credits` : ""}
                  </Button>
                  <p className="text-xs text-white/55">
                    Long videos are written as an outline, then chapter by chapter (about {Math.round(seconds / 300)} chapters of 5 minutes, a new picture every ~12 seconds), then filmed chapter by chapter and joined into one video. Filming takes {filmTime(seconds)} on Kinetrove&apos;s server, and it carries on by itself if the server restarts. You&apos;ll get a notification when it&apos;s ready.
                  </p>
                </>
              ) : (
                <Button variant="primary" size="lg" loading={busy === "plan"} disabled={idea.trim().length < 8} onClick={write}>
                  <Sparkles className="h-4 w-4" /> Write the shots
                </Button>
              )}
            </div>
          </Card>

          {plan && !long && (
            <Card>
              <CardHeader title={`2. ${plan.title || "Your shots"}`} subtitle="Change anything: what the voice says, what each picture shows, how the camera moves." icon={<Clapperboard className="h-4 w-4" />} />
              <div className="flex flex-col gap-3 p-5">
                {plan.scenes.map((s, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
                      <span>Shot {i + 1} · {s.seconds} s</span>
                      <Select aria-label={`Shot ${i + 1} camera move`} value={s.move} onChange={(e) => setShot(i, { move: e.target.value as Move })} className="h-8 w-40 text-xs normal-case tracking-normal">
                        {Object.entries(MOVE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </div>
                    <Textarea rows={2} value={s.narration} onChange={(e) => setShot(i, { narration: e.target.value })} placeholder="What the voice says (empty = no words)" aria-label={`Shot ${i + 1} narration`} />
                    <Textarea rows={2} value={s.visual} onChange={(e) => setShot(i, { visual: e.target.value })} placeholder="What the picture shows" aria-label={`Shot ${i + 1} picture`} />
                    {!!s.effects.length && <div className="text-xs text-white/50">Effects: {s.effects.join(", ").replace(/_/g, " ")}</div>}
                  </div>
                ))}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-3 text-sm text-white/80"><Switch checked={voice} onChange={setVoice} label="Voice reads the words" /> Voice reads the words</label>
                  <MediaSelect items={items} kinds={["audio"]} value={music} onChange={setMusic} empty="No music (a score is drawn under the voice)" />
                </div>
                <Button variant="primary" size="lg" loading={busy === "film"} disabled={!!offline} onClick={film}>
                  <Film className="h-4 w-4" /> Film it{credits ? ` · about ${credits} credits` : ""}
                </Button>
                <p className="text-xs text-white/50">Pictures and the voice use credits; the filming itself is free. A 30-second video takes a few minutes. You&apos;ll get a notification when it&apos;s ready.</p>
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Your videos" subtitle="Also in your Media Library." icon={<Film className="h-4 w-4" />} />
            <div className="flex flex-col gap-3 p-4">
              {!movies?.movies.length && <p className="text-sm text-white/50">Nothing filmed yet.</p>}
              {movies?.movies.slice(0, 4).map((m) => (
                <div key={m.id}>
                  <div className="mb-1 truncate text-xs text-white/60">{m.title} · {Math.round(m.seconds)} s</div>
                  <video src={m.videoUrl} controls preload="metadata" className="w-full rounded-lg bg-black" />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="More in the lab" icon={<UserRound className="h-4 w-4" />} />
            <div className="flex flex-col gap-2 p-4 text-sm">
              <Link className="text-mint-300 underline" href="/voice-lab?tab=presenter">Talking Presenter: a person says your script, lips in sync</Link>
              <Link className="text-mint-300 underline" href="/video-tools?tab=music">Music Video: your song, cut to the beat</Link>
              <Link className="text-mint-300 underline" href="/voice-lab?tab=v2v">Put a voice on any video</Link>
              <Link className="text-mint-300 underline" href="/movie-maker">Movie Maker: full control, scene by scene</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
