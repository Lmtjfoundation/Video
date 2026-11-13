"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Film, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, MOVIE_MAKER_HANDOFF } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { MediaSelect, useMedia } from "@/components/voice-tools";
import { movieCredits, sceneFrom, type Effect, type Frame, type MoviePlan, type MovieScene, type Move, type TitleStyle } from "@/lib/movie-maker";

type Data = {
  movies: { id: string; title: string; scenes: number; seconds: number; videoUrl: string; createdAt: string }[];
  characters: { id: string; name: string; imageUrl: string }[];
  options: { moves: Record<Move, string>; effects: Record<Effect, string>; frames: Record<Frame, string>; titles: Record<TitleStyle, string>; grades: Record<string, string> };
  cost: { aiImage: number; speech: number };
  ready: { pictures: string | null; engine: boolean };
};

const EXAMPLE = `1. [0:00–0:05] The lighthouse keeper climbed the last stair as the storm hit.
   On screen: The last night.
   Visual: Low-angle shot of an old lighthouse on black rocks in a violent storm, rain lashing, warm lamp glow at the top, 85mm lens.
   Edit: Slow tilt-up from the rocks to the lamp  ·  SFX: Thunder, crashing waves

2. [0:05–0:10] Keeper: "Something is out there, and it's coming for the light."
   On screen: Not alone.
   Visual: Close-up of a weathered old man's face lit by a flickering lantern, fog on the glass behind him.
   Edit: Slow push-in  ·  SFX: Wind howl, lantern creak`;

export default function MovieMaker() {
  const { toast, refresh } = useApp();
  const { items } = useMedia();
  const [data, setData] = useState<Data | null>(null);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<MoviePlan | null>(null);
  const [grade, setGrade] = useState("cadmium_purple");
  const [cast, setCast] = useState<string[]>([]);
  const [voice, setVoice] = useState(true);
  const [music, setMusic] = useState("");
  const [endCard, setEndCard] = useState("Follow for Part 2");
  const [fiction, setFiction] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Data>("/api/movie-maker").then(setData).catch((e) => toast((e as Error).message, "error")), [toast]);
  useEffect(() => {
    load();
    window.addEventListener("ghostpost:job-done", load);
    return () => window.removeEventListener("ghostpost:job-done", load);
  }, [load]);

  // An episode handed over from the Writers' Room: paste its plan and make the scenes straight away.
  useEffect(() => {
    const raw = sessionStorage.getItem(MOVIE_MAKER_HANDOFF);
    if (!raw) return;
    sessionStorage.removeItem(MOVIE_MAKER_HANDOFF);
    try {
      const h = JSON.parse(raw) as { text: string; title?: string };
      setText(h.text);
      api<{ plan: MoviePlan }>("/api/movie-maker", { body: { action: "parse", text: h.text } })
        .then((r) => {
          setPlan({ ...r.plan, title: h.title || r.plan.title });
          toast(`${r.plan.scenes.length} scenes ready from the Writers' Room.`, "success");
        })
        .catch((e) => toast((e as Error).message, "error"));
    } catch {
      /* ignore a broken hand-off */
    }
  }, [toast]);

  const credits = useMemo(() => (plan && data ? movieCredits(plan, data.cost, voice) : 0), [plan, data, voice]);
  const seconds = plan ? plan.scenes.reduce((n, s) => n + s.seconds, 0) : 0;

  async function parse() {
    setBusy(true);
    try {
      const r = await api<{ plan: MoviePlan }>("/api/movie-maker", { body: { action: "parse", text } });
      setPlan(r.plan);
      toast(`${r.plan.scenes.length} scenes ready. Adjust any scene, then make the movie.`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function render() {
    if (!plan) return;
    setBusy(true);
    try {
      await api("/api/movie-maker", { body: { action: "render", plan, grade, characterIds: cast, voice, musicMediaId: music || undefined, endCard, fiction } });
      jobStarted();
      toast("Making your movie on Vueio's server. You can close the app; you'll get a notification when it's ready.", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const setScene = (i: number, patch: Partial<MovieScene>) => setPlan((p) => (p ? { ...p, scenes: p.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : p));
  const removeScene = (i: number) => setPlan((p) => (p ? { ...p, scenes: p.scenes.filter((_, j) => j !== i) } : p));
  const addScene = () => setPlan((p) => ({ ...(p ?? { title: "My movie", look: "", voice: "", music: "", caption: "" }), scenes: [...(p?.scenes ?? []), sceneFrom({ narration: "", visual: "" }, p?.scenes.length ?? 0)] }));
  const o = data?.options;

  return (
    <>
      <PageHeader title="Movie Maker" subtitle="Motion-graphics movies from a scene plan: 3D camera moves, fog, frost, glass shatter, ghost mist, colour grades, cinema bars, animated titles, voices and score. Rendered on Vueio's own engine." />
      {data && !data.ready.engine && <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">The motion engine isn&apos;t installed on this server yet. You can plan scenes now; making the movie needs the engine.</p>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-6">
          <Card className="min-w-0">
            <CardHeader title="1. Your plan" subtitle="Paste a scene plan (numbered scenes with On screen, Visual, Edit and SFX lines) or plain paragraphs. Each becomes a scene." icon={<Clapperboard className="h-4 w-4" />} />
            <div className="grid gap-3 p-5">
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="Scene plan" />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={parse} disabled={busy || text.trim().length < 10}><Wand2 className="h-4 w-4" /> Make scenes</Button>
                <Button variant="secondary" onClick={() => setText(EXAMPLE)}>Try the example</Button>
                <Button variant="secondary" onClick={addScene}><Plus className="h-4 w-4" /> Start blank</Button>
              </div>
            </div>
          </Card>

          {plan && o && (
            <Card className="min-w-0">
              <CardHeader title={`2. Scenes (${plan.scenes.length}, about ${Math.round(seconds)}s)`} subtitle="Camera moves and effects are picked from each scene's words. Change anything." icon={<Film className="h-4 w-4" />} />
              <div className="grid gap-4 p-5">
                <Field label="Title card"><Input value={plan.title} onChange={(e) => setPlan({ ...plan, title: e.target.value })} maxLength={120} /></Field>
                {plan.scenes.map((s, i) => (
                  <div key={i} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-testid="scene-card">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <Badge tone="mint">Scene {i + 1}</Badge>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={2} max={20} value={s.seconds} onChange={(e) => setScene(i, { seconds: Number(e.target.value) })} className="w-20" aria-label="Seconds" />
                        <span className="text-xs text-white/50">sec</span>
                        <button onClick={() => removeScene(i)} className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Remove scene"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Field label="Narration or line"><Textarea rows={3} value={s.narration} onChange={(e) => setScene(i, { narration: e.target.value })} /></Field>
                      <Field label="Picture (what we see)"><Textarea rows={3} value={s.visual} onChange={(e) => setScene(i, { visual: e.target.value })} /></Field>
                      <Field label="On-screen title"><Input value={s.onScreen} onChange={(e) => setScene(i, { onScreen: e.target.value })} maxLength={60} /></Field>
                      <Field label="Or use a picture from your library"><MediaSelect items={items} kinds={["image"]} value={s.mediaId ?? ""} onChange={(v) => setScene(i, { mediaId: v || undefined })} empty="Make one from the description" /></Field>
                      <Field label="Camera move">
                        <Select value={s.move} onChange={(e) => setScene(i, { move: e.target.value as Move })}>{Object.entries(o.moves).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Frame"><Select value={s.frame} onChange={(e) => setScene(i, { frame: e.target.value as Frame })}>{Object.entries(o.frames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                        <Field label="Title style"><Select value={s.titleStyle} onChange={(e) => setScene(i, { titleStyle: e.target.value as TitleStyle })}>{Object.entries(o.titles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Effects">
                      {(Object.keys(o.effects) as Effect[]).map((fx) => {
                        const on = s.effects.includes(fx);
                        return (
                          <button key={fx} onClick={() => setScene(i, { effects: on ? s.effects.filter((x) => x !== fx) : [...s.effects, fx].slice(0, 6) })} aria-pressed={on} className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-mint-400 bg-mint-400/15 text-mint-200" : "border-white/10 text-white/60 hover:bg-white/5")}>
                            {o.effects[fx]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <Button variant="secondary" onClick={addScene}><Plus className="h-4 w-4" /> Add scene</Button>
              </div>
            </Card>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Card className="min-w-0">
            <CardHeader title="3. Film settings" icon={<Sparkles className="h-4 w-4" />} />
            <div className="grid gap-4 p-5">
              <Field label="Look"><Select value={grade} onChange={(e) => setGrade(e.target.value)}>{o && Object.entries(o.grades).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              {!!data?.characters.length && (
                <Field label="Cast (same faces in every scene)" hint="Up to 3">
                  <div className="flex flex-wrap gap-2">
                    {data.characters.map((c) => {
                      const on = cast.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => setCast(on ? cast.filter((x) => x !== c.id) : [...cast, c.id].slice(0, 3))} className={cn("flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs", on ? "border-mint-400 bg-mint-400/10" : "border-white/10")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.imageUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> {c.name}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice the narration and lines</label>
              <Field label="Score" hint="Without one, a low cinematic drone plays under the voice."><MediaSelect items={items} kinds={["audio"]} value={music} onChange={setMusic} empty="Cinematic drone" /></Field>
              <Field label="End card"><Input value={endCard} onChange={(e) => setEndCard(e.target.value)} maxLength={60} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fiction} onChange={(e) => setFiction(e.target.checked)} /> Label as fiction</label>
              <Button variant="primary" onClick={render} disabled={busy || !plan?.scenes.length || !data?.ready.engine}><Film className="h-4 w-4" /> Make movie{credits ? ` (${credits} credits)` : ""}</Button>
              <p className="text-xs text-white/50">Pictures and voices use credits; the motion render itself is free. A 3-minute movie takes about 25 minutes on Vueio&apos;s server. You can close the app or lock your phone; you&apos;ll get a notification when it&apos;s ready.</p>
            </div>
          </Card>

          <Card className="min-w-0">
            <CardHeader title="Your movies" />
            <div className="grid gap-4 p-5">
              {!data?.movies.length && <p className="text-sm text-white/50">Finished movies appear here and in your Library.</p>}
              {data?.movies.map((m) => (
                <div key={m.id} className="min-w-0">
                  <video src={m.videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-xl bg-black" />
                  <p className="mt-2 text-sm font-medium">{m.title}</p>
                  <p className="text-xs text-white/50">{m.scenes} scenes · {m.seconds}s</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
