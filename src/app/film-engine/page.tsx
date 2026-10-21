"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, AudioLines, Clapperboard, Download, Film, Mic, Plus, RotateCcw, Scissors, Sparkles, Trash2, Undo2, UserRound, Wand2, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Switch, Textarea } from "@/components/ui";

type Kind = "image" | "video" | "audio";
type Ref = { id: string; kind: Kind; mediaId: string; label: string; url: string | null };
type Status = "draft" | "queued" | "generating" | "done" | "failed";
type Seg = { id: string; title: string; seconds: number; shots: string; continueFrom: boolean; status: Status; message?: string; clipMediaId?: string; clipUrl?: string | null; history?: string[]; cost?: number };
type Engine = "own" | "gemini" | "seedance" | "wan" | "free";
const ENGINES: Engine[] = ["own", "gemini", "seedance", "wan", "free"];
type Cut = {
  id: string; title: string; logline: string; style: string; aspect: string; engine: Engine; nativeAudio: boolean; score: boolean;
  refs: Ref[]; segments: Seg[]; final?: { status: Status; mediaId?: string; message?: string }; finalUrl?: string | null;
};
type Data = {
  cuts: Cut[]; films: { id: string; title: string; logline: string }[]; engines: Record<Engine, boolean>; voice: boolean; ffmpeg: boolean;
  limits: { cuts: number; segments: number; refs: Record<Kind, number> }; prices: { plan: number; beat: number; ownSecond: number; veoSecond: number; seedanceSecond: number; wanSecond: number };
};
type MediaItem = { id: string; name: string; kind: Kind; url: string };
type Character = { id: string; name: string; imageMediaId: string; imageUrl: string };

const ENGINE_LABEL: Record<Engine, string> = { own: "Ghost Post engine — your own model on your GPU, no per-clip fees", gemini: "Google Veo 3.1 (Gemini) — full motion with its own sound, 8-second clips", seedance: "Seedance 2.5 — full motion, references, native sound", wan: "Wan 2.2 — low-cost motion, chained clips", free: "Free — camera moves on your pictures" };
const ASPECTS = ["9:16", "16:9", "21:9", "1:1"];
const busy = (s?: { status: Status }) => s?.status === "queued" || s?.status === "generating";
const STATUS_TONE: Record<Status, "neutral" | "gold" | "mint" | "red"> = { draft: "neutral", queued: "gold", generating: "gold", done: "mint", failed: "red" };
const STATUS_LABEL: Record<Status, string> = { draft: "Not filmed", queued: "Queued", generating: "Filming…", done: "Filmed", failed: "Failed" };

export default function FilmEngine() {
  const { status, toast, refresh } = useApp();
  const admin = status?.me.user.role === "admin";
  const [data, setData] = useState<Data | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Cut | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/api/film-engine");
      setData(d);
      setDraft((cur) => {
        if (!cur) return cur;
        const server = d.cuts.find((c) => c.id === cur.id);
        if (!server) return null;
        if (!dirtyRef.current) return server;
        // Keep the user's unsaved writing; take the footage and progress from the server.
        return {
          ...cur,
          final: server.final,
          finalUrl: server.finalUrl,
          segments: cur.segments.map((s) => {
            const sv = server.segments.find((x) => x.id === s.id);
            return sv ? { ...s, status: sv.status, message: sv.message, clipMediaId: sv.clipMediaId, clipUrl: sv.clipUrl, history: sv.history, cost: sv.cost } : s;
          }),
        };
      });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep progress moving while anything is being filmed or cut.
  const working = !!draft && (draft.segments.some(busy) || busy(draft.final));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [working, load]);

  const open = (c: Cut) => {
    setOpenId(c.id);
    setDraft(c);
    setDirty(false);
  };
  const edit = (patch: Partial<Cut>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const editSeg = (id: string, patch: Partial<Seg>) => edit({ segments: draft!.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  async function save(quiet = false): Promise<Cut | null> {
    if (!draft) return null;
    try {
      const c = await api<Cut>("/api/film-engine", {
        body: {
          action: "update", id: draft.id, title: draft.title, logline: draft.logline, style: draft.style, aspect: draft.aspect, engine: draft.engine,
          nativeAudio: draft.nativeAudio, score: draft.score,
          refs: draft.refs.map((r) => ({ id: r.id, mediaId: r.mediaId, label: r.label })),
          segments: draft.segments.map((s) => ({ id: s.id, title: s.title, seconds: s.seconds, shots: s.shots, continueFrom: s.continueFrom })),
        },
      });
      setDirty(false);
      if (!quiet) toast("Saved", "success");
      await load();
      return c;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    }
  }

  async function act(body: Record<string, unknown>, done?: string) {
    if (!draft) return;
    if (dirty) {
      const saved = await save(true);
      if (!saved) return;
      // A beat added since the last save gets its id from the server.
      const i = draft.segments.findIndex((s) => s.id === body.segId);
      if (i >= 0 && saved.segments[i]) body = { ...body, segId: saved.segments[i].id };
    }
    try {
      await api<Cut>("/api/film-engine", { body: { id: draft.id, ...body } });
      if (done) toast(done, "success");
      setDirty(false);
      await load();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const credits = (n: number) => (admin ? "owner · no credits" : `${n.toLocaleString()} credits`);
  const engineReady = !data || !draft || data.engines[draft.engine];

  return (
    <div>
      <PageHeader
        title="Film Engine"
        subtitle="Direct a film the way Seedance 2.5 works: beats of up to 30 seconds with timestamped shot lists, a reference library for your cast, places and voices, continuous extensions, moment-level fixes, and an edit room that cuts it together."
      />
      {data && !data.engines.own && !data.engines.gemini && !data.engines.seedance && (
        <div className="mb-5 rounded-xl bg-gold-400/[0.08] p-4 text-sm text-gold-300 ring-1 ring-gold-300/25">
          {admin
            ? "Full motion needs a video model on a GPU. Ghost Post has its own (Wan 2.2, open weights): start it on a rented GPU server with engine/README.md, then add its address and token in Admin → App settings → Integrations → Ghost Post Video Engine. Until then, films use the free engine: cinematic camera moves on your reference pictures."
            : "Full-motion filming isn't switched on yet (the app's owner needs to start Ghost Post's video engine). You can direct and film with the free engine now."}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <NewFilm data={data} admin={admin} onMade={(c) => { load().then(() => open(c)); refresh(); }} />
          <Card>
            <CardHeader title="Your films" icon={<Film className="h-4 w-4" />} />
            <div className="grid gap-2 p-4">
              {data?.cuts.length ? (
                data.cuts.map((c) => (
                  <button key={c.id} onClick={() => open(c)} className={cn("rounded-xl p-3 text-left ring-1 transition", openId === c.id ? "bg-mint-400/[0.08] ring-mint-400/30" : "bg-white/[0.03] ring-white/[0.06] hover:bg-white/[0.06]")}>
                    <p className="truncate text-sm font-medium text-white">{c.title}</p>
                    <p className="mt-0.5 text-xs text-white/45">
                      {c.segments.length} beats · {c.segments.filter((s) => s.clipMediaId).length} filmed · {c.segments.reduce((t, s) => t + s.seconds, 0)}s · {c.aspect}
                    </p>
                  </button>
                ))
              ) : (
                <p className="text-sm text-white/45">No films yet. Start one above.</p>
              )}
            </div>
          </Card>
        </div>

        {draft && data ? (
          <div className="grid content-start gap-5">
            <Card>
              <CardHeader
                title={<Input value={draft.title} onChange={(e) => edit({ title: e.target.value })} className="h-9 max-w-md text-base font-semibold" aria-label="Film title" />}
                icon={<Clapperboard className="h-4 w-4" />}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={() => save()} disabled={!dirty}>Save</Button>
                    <Button size="sm" variant="danger" aria-label="Delete film" onClick={async () => {
                      if (!confirm(`Delete “${draft.title}”? The clips stay in your Media Library.`)) return;
                      try {
                        await api(`/api/film-engine?id=${draft.id}`, { method: "DELETE" });
                        setDraft(null);
                        setOpenId(null);
                        load();
                      } catch (e) {
                        toast((e as Error).message, "error");
                      }
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                }
              />
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <Field label="Logline"><Input value={draft.logline} onChange={(e) => edit({ logline: e.target.value })} placeholder="One sentence: who, what they want, what stands in the way." /></Field>
                <Field label="Look and tone (every beat)"><Input value={draft.style} onChange={(e) => edit({ style: e.target.value })} placeholder="Photorealistic, anamorphic, teal and amber, rain-soaked nights" /></Field>
                <Field label="Engine" hint={!engineReady ? "Needs a Replicate token (see above)." : undefined}>
                  <Select value={draft.engine} onChange={(e) => edit({ engine: e.target.value as Engine })}>
                    {ENGINES.map((e) => <option key={e} value={e}>{ENGINE_LABEL[e]}{data.engines[e] ? "" : " (not connected)"}</option>)}
                  </Select>
                </Field>
                <Field label="Frame">
                  <Select value={draft.aspect} onChange={(e) => edit({ aspect: e.target.value })}>
                    {ASPECTS.map((a) => <option key={a} value={a}>{a === "9:16" ? "9:16 vertical (Reels, TikTok, Shorts)" : a === "16:9" ? "16:9 widescreen" : a === "21:9" ? "21:9 cinemascope" : "1:1 square"}</option>)}
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-6 md:col-span-2">
                  <Toggle checked={draft.nativeAudio} onChange={(v) => edit({ nativeAudio: v })} label="Native sound (dialogue, effects, music made with the picture)" />
                  <Toggle checked={draft.score} onChange={(v) => edit({ score: v })} label="Score bed under the finished film" />
                </div>
              </div>
            </Card>

            <References draft={draft} data={data} onChange={(refs) => edit({ refs })} />

            {draft.segments.map((s, i) => (
              <Beat
                key={s.id}
                seg={s}
                index={i}
                count={draft.segments.length}
                engine={draft.engine}
                engineReady={engineReady}
                costLabel={credits(s.cost ?? 0)}
                onEdit={(p) => editSeg(s.id, p)}
                onMove={(dir) => {
                  const list = [...draft.segments];
                  const [x] = list.splice(i, 1);
                  list.splice(i + dir, 0, x);
                  edit({ segments: list });
                }}
                onDelete={() => edit({ segments: draft.segments.filter((x) => x.id !== s.id) })}
                onFilm={(fix) => act({ action: "generate", segId: s.id, fix }, fix ? "Fixing that moment…" : "Filming…")}
                onUndo={() => act({ action: "undo", segId: s.id }, "Back to the earlier take")}
              />
            ))}

            <NextBeat price={credits(data.prices.beat)} onBlank={() => edit({ segments: [...draft.segments, { id: `new_${Date.now()}`, title: "New beat", seconds: 20, shots: "0–8s: \n8–16s: \n16–20s: ", continueFrom: true, status: "draft" }] })} onWrite={(direction) => act({ action: "next", direction }, "The director wrote the next beat")} />

            <Card>
              <CardHeader title="Edit room" subtitle="Joins every filmed beat in order at the film's frame, keeps each beat's sound, adds the score if chosen, and sets the loudness for social platforms (−14 LUFS)." icon={<Scissors className="h-4 w-4" />} />
              <div className="grid gap-4 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="gold" loading={busy(draft.final)} disabled={!draft.segments.some((s) => s.clipMediaId)} onClick={() => act({ action: "assemble" }, "Cutting the film together…")}>
                    <Film className="h-4 w-4" /> {draft.final?.status === "done" ? "Re-cut the film" : "Make the film"}
                  </Button>
                  {draft.final && <Badge tone={STATUS_TONE[draft.final.status]}>{draft.final.status === "generating" ? "Cutting…" : draft.final.status === "done" ? "Ready" : STATUS_LABEL[draft.final.status]}</Badge>}
                  {draft.final?.message && <span className="text-xs text-white/50">{draft.final.message}</span>}
                </div>
                {draft.finalUrl && (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,360px)_1fr]">
                    <video src={draft.finalUrl} controls playsInline className={cn("w-full rounded-xl bg-black", draft.aspect === "9:16" ? "aspect-[9/16]" : "aspect-video")} />
                    <div className="grid content-start gap-2 text-sm text-white/60">
                      <p>The film is saved in your Media Library, where you can attach it to posts and schedule it.</p>
                      <a href={`${draft.finalUrl}&dl=${encodeURIComponent(draft.title.replace(/[^\w-]+/g, "-"))}.mp4`}><Button variant="secondary"><Download className="h-4 w-4" /> Download MP4</Button></a>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="p-8">
            <Empty icon={<Clapperboard className="h-5 w-5" />} title="Open or start a film" body="Tell the director your story (or pick a Writers' Room project). It plans the film as beats with shot lists you can edit, then you film each beat, extend, fix moments and cut it together." />
          </Card>
        )}
      </div>
    </div>
  );
}

function NewFilm({ data, admin, onMade }: { data: Data | null; admin: boolean; onMade: (c: Cut) => void }) {
  const toast = useApp((s) => s.toast);
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [filmId, setFilmId] = useState("");
  const [style, setStyle] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [engine, setEngine] = useState<Engine>("own");
  const [beats, setBeats] = useState(3);
  const [seconds, setSeconds] = useState(25);
  const [busyNow, setBusy] = useState(false);
  useEffect(() => {
    if (data) setEngine(ENGINES.find((e) => data.engines[e]) ?? "free");
  }, [data]);

  async function make(plan: boolean) {
    setBusy(true);
    try {
      const c = await api<Cut>("/api/film-engine", { body: { action: "create", plan, title, story, filmId: filmId || undefined, style, aspect, engine, beats, seconds } });
      toast(plan ? `The director planned “${c.title}” in ${c.segments.length} beats` : "Film started", "success");
      setStory("");
      setTitle("");
      onMade(c);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="New film" subtitle="The director breaks your story into beats of up to 30 seconds, each a timestamped shot list in camera language." icon={<Sparkles className="h-4 w-4" />} />
      <div className="grid gap-3 p-4">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Settlement" /></Field>
        {!!data?.films.length && (
          <Field label="From the Writers' Room">
            <Select value={filmId} onChange={(e) => setFilmId(e.target.value)}>
              <option value="">— Write the story below —</option>
              {data.films.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
            </Select>
          </Field>
        )}
        {!filmId && <Field label="Story, script or shot ideas"><Textarea rows={5} value={story} onChange={(e) => setStory(e.target.value)} placeholder="Who it's about, what happens, how it ends. Paste a script or timestamped directions if you have them." /></Field>}
        <Field label="Look and tone"><Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Photorealistic, anamorphic lens, moody night rain" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Beats"><Input type="number" min={1} max={40} value={beats} onChange={(e) => setBeats(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} /></Field>
          <Field label="Seconds each"><Input type="number" min={5} max={30} value={seconds} onChange={(e) => setSeconds(Math.max(5, Math.min(30, Number(e.target.value) || 25)))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Frame"><Select value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map((a) => <option key={a}>{a}</option>)}</Select></Field>
          <Field label="Engine"><Select value={engine} onChange={(e) => setEngine(e.target.value as Engine)}>{ENGINES.map((e) => <option key={e} value={e}>{e === "own" ? "Ghost Post engine" : e === "gemini" ? "Google Veo 3.1" : e === "seedance" ? "Seedance 2.5" : e === "wan" ? "Wan 2.2" : "Free"}</option>)}</Select></Field>
        </div>
        <p className="text-xs text-white/45">About {beats * seconds} seconds of film. You can add your cast and references after planning; the shot lists cite them as @Name.</p>
        <Button variant="primary" loading={busyNow} disabled={!filmId && story.trim().length < 20} onClick={() => make(true)}>
          <Wand2 className="h-4 w-4" /> Plan with the director · {admin ? "owner" : `${data?.prices.plan ?? 4} credits`}
        </Button>
        <Button variant="ghost" disabled={busyNow} onClick={() => make(false)}>Start blank (write the shots yourself)</Button>
      </div>
    </Card>
  );
}

function References({ draft, data, onChange }: { draft: Cut; data: Data; onChange: (refs: Ref[]) => void }) {
  const toast = useApp((s) => s.toast);
  const [picker, setPicker] = useState<"library" | "cast" | "voice" | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [cast, setCast] = useState<Character[]>([]);
  const [line, setLine] = useState("");
  const [who, setWho] = useState("");
  const [voicing, setVoicing] = useState(false);
  const counts = useMemo(() => ({ image: draft.refs.filter((r) => r.kind === "image").length, video: draft.refs.filter((r) => r.kind === "video").length, audio: draft.refs.filter((r) => r.kind === "audio").length }), [draft.refs]);

  async function show(p: "library" | "cast" | "voice") {
    setPicker(picker === p ? null : p);
    try {
      if (p === "library" && !media.length) setMedia((await api<{ items: MediaItem[] }>("/api/media")).items);
      if (p === "cast" && !cast.length) setCast((await api<{ characters: Character[] }>("/api/characters")).characters);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const add = (r: Omit<Ref, "id">) => {
    if (draft.refs.some((x) => x.mediaId === r.mediaId)) return toast("That's already in the library", "info");
    if (counts[r.kind] >= data.limits.refs[r.kind]) return toast(`Up to ${data.limits.refs[r.kind]} ${r.kind === "image" ? "pictures" : r.kind === "video" ? "clips" : "audio files"}`, "error");
    onChange([...draft.refs, { ...r, id: `new_${r.mediaId}` }]);
  };

  async function voice() {
    setVoicing(true);
    try {
      const m = await api<MediaItem>("/api/film-engine", { body: { action: "voice", text: line, note: who } });
      add({ kind: "audio", mediaId: m.id, label: `${who || "Voice"} line ${counts.audio + 1}`, url: m.url });
      setLine("");
      toast("Voice line added. Cite it in a shot to lip-sync to it.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setVoicing(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="References"
        subtitle={`Cast, places, style frames, clips and voices. Cite them in shot lists as @Name. ${counts.image}/${data.limits.refs.image} pictures · ${counts.video}/${data.limits.refs.video} clips · ${counts.audio}/${data.limits.refs.audio} audio.`}
        icon={<UserRound className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => show("cast")}><UserRound className="h-3.5 w-3.5" /> Cast</Button>
            <Button size="sm" onClick={() => show("library")}><Plus className="h-3.5 w-3.5" /> Media Library</Button>
            <Button size="sm" onClick={() => show("voice")} disabled={!data.voice}><Mic className="h-3.5 w-3.5" /> Voice a line</Button>
          </div>
        }
      />
      <div className="grid gap-4 p-5">
        {picker === "cast" && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
            {cast.length ? cast.map((c) => (
              <button key={c.id} onClick={() => add({ kind: "image", mediaId: c.imageMediaId, label: c.name.split(" ")[0], url: c.imageUrl })} className="overflow-hidden rounded-lg ring-1 ring-white/10 hover:ring-mint-400/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt={c.name} className="aspect-square w-full object-cover" />
                <span className="block truncate px-1.5 py-1 text-[11px] text-white/80">{c.name}</span>
              </button>
            )) : <p className="col-span-full text-sm text-white/45">No characters yet. Make them in Movie Studio, or add portraits from the Media Library.</p>}
          </div>
        )}
        {picker === "library" && (
          <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5 lg:grid-cols-7">
            {media.map((m) => (
              <button key={m.id} onClick={() => add({ kind: m.kind, mediaId: m.id, label: m.name.replace(/\.\w+$/, "").replace(/[-_]+/g, " ").slice(0, 24), url: m.url })} className="overflow-hidden rounded-lg bg-ink-950 ring-1 ring-white/10 hover:ring-mint-400/50">
                <Thumb kind={m.kind} url={m.url} name={m.name} />
                <span className="block truncate px-1.5 py-1 text-[11px] text-white/70">{m.name}</span>
              </button>
            ))}
            {!media.length && <p className="col-span-full text-sm text-white/45">Your Media Library is empty. Upload pictures, clips or audio there first.</p>}
          </div>
        )}
        {picker === "voice" && (
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
            <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who (e.g. Tasha)" />
            <Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="The line, as spoken: Where were you last night?" />
            <Button variant="primary" loading={voicing} disabled={line.trim().length < 2} onClick={voice}><AudioLines className="h-4 w-4" /> Voice it</Button>
          </div>
        )}
        {draft.refs.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {draft.refs.map((r) => (
              <div key={r.id} className="overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/[0.08]">
                <div className="relative bg-ink-950">
                  <Thumb kind={r.kind} url={r.url} name={r.label} />
                  <button className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white/80 hover:text-white" aria-label={`Remove ${r.label}`} onClick={() => onChange(draft.refs.filter((x) => x.id !== r.id))}><X className="h-3.5 w-3.5" /></button>
                  <Badge tone={r.kind === "image" ? "violet" : r.kind === "audio" ? "gold" : "sky"} className="absolute left-1.5 top-1.5">{r.kind}</Badge>
                </div>
                <div className="flex items-center gap-1 p-2">
                  <span className="text-sm text-mint-300">@</span>
                  <input value={r.label} onChange={(e) => onChange(draft.refs.map((x) => (x.id === r.id ? { ...x, label: e.target.value.replace(/[@[\]]/g, "") } : x)))} className="w-full bg-transparent text-sm text-white outline-none" aria-label="Reference name" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/45">Add your cast portraits first: they keep every face consistent across beats. Then add locations, style frames, motion clips or voice lines.</p>
        )}
      </div>
    </Card>
  );
}

/** A switch with its label shown beside it (clicking the words flips it too). */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-white/70">
      <Switch checked={checked} onChange={onChange} label={label} />
      <span>{label}</span>
    </label>
  );
}

function Thumb({ kind, url, name }: { kind: Kind; url: string | null; name: string }) {
  if (!url) return <div className="aspect-square" />;
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="aspect-square w-full object-cover" loading="lazy" />;
  }
  if (kind === "video") return <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="aspect-square w-full object-cover" />;
  return (
    <div className="grid aspect-square place-items-center bg-gradient-to-br from-gold-400/15 to-violet-500/10 p-2">
      <audio src={url} controls preload="none" className="w-full" />
    </div>
  );
}

function Beat({ seg, index, count, engine, engineReady, costLabel, onEdit, onMove, onDelete, onFilm, onUndo }: {
  seg: Seg; index: number; count: number; engine: Engine; engineReady: boolean; costLabel: string;
  onEdit: (p: Partial<Seg>) => void; onMove: (dir: -1 | 1) => void; onDelete: () => void; onFilm: (fix?: string) => void; onUndo: () => void;
}) {
  const [fix, setFix] = useState("");
  const [fixing, setFixing] = useState(false);
  const working = busy(seg);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-5 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold text-white/80">{index + 1}</span>
        <Input value={seg.title} onChange={(e) => onEdit({ title: e.target.value })} className="h-8 max-w-xs flex-1" aria-label="Beat title" />
        <div className="flex items-center gap-1.5 text-xs text-white/50">
          <Input type="number" min={3} max={30} value={seg.seconds} onChange={(e) => onEdit({ seconds: Math.max(3, Math.min(30, Number(e.target.value) || 10)) })} className="h-8 w-16" aria-label="Seconds" /> s
        </div>
        <Badge tone={STATUS_TONE[seg.status]}>{STATUS_LABEL[seg.status]}</Badge>
        <div className="ml-auto flex gap-1">
          <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" disabled={working} onClick={() => confirm("Remove this beat?") && onDelete()} aria-label="Remove beat"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="grid content-start gap-3">
          <Textarea
            rows={Math.min(12, Math.max(5, seg.shots.split("\n").length + 1))}
            value={seg.shots}
            onChange={(e) => onEdit({ shots: e.target.value })}
            className="font-mono text-[13px] leading-relaxed"
            placeholder={'0–8s: wide establishing shot of @Kitchen at night, slow push-in. Rain against the window.\n8–18s: medium on @Marcus as he sets the keys down. Marcus: "I gave you every key."\n18–25s: close-up on @Tasha, rack focus to the phone lighting up. Cut to black.'}
          />
          {index > 0 && <Toggle checked={seg.continueFrom} onChange={(v) => onEdit({ continueFrom: v })} label={engine === "seedance" ? "Extend: continue from the end of the beat before (characters, light, camera and sound carry over)" : "Continue from the last frame of the beat before"} />}
          {seg.message && <p className={cn("text-xs", seg.status === "failed" ? "text-red-300" : "text-white/50")}>{seg.message}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={working} disabled={!engineReady || !seg.shots.trim()} onClick={() => onFilm()}>
              {seg.clipMediaId ? <RotateCcw className="h-4 w-4" /> : <Clapperboard className="h-4 w-4" />} {seg.clipMediaId ? "Re-film" : "Film this beat"} · {costLabel}
            </Button>
            {!!seg.clipMediaId && <Button variant="secondary" disabled={working} onClick={() => setFixing(!fixing)}><Wand2 className="h-4 w-4" /> Fix a moment</Button>}
            {!!seg.history?.length && <Button variant="ghost" disabled={working} onClick={onUndo}><Undo2 className="h-4 w-4" /> Earlier take</Button>}
          </div>
          {fixing && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input value={fix} onChange={(e) => setFix(e.target.value)} placeholder={engine === "seedance" ? "At 12–15s, make the phone screen glow blue and keep his hand still" : "Describe the change; the beat is re-filmed with it"} />
              <Button variant="gold" disabled={fix.trim().length < 4 || working} onClick={() => { onFilm(fix); setFixing(false); setFix(""); }}>Apply · {costLabel}</Button>
            </div>
          )}
        </div>
        <div className="grid content-start">
          {seg.clipUrl ? (
            <video key={seg.clipUrl} src={seg.clipUrl} controls playsInline className="aspect-[9/16] w-full rounded-xl bg-black object-contain" />
          ) : (
            <div className="grid aspect-[9/16] place-items-center rounded-xl bg-white/[0.03] p-4 text-center text-xs text-white/35 ring-1 ring-white/[0.06]">{working ? "Filming… this takes a few minutes." : "The beat's footage appears here."}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

function NextBeat({ price, onBlank, onWrite }: { price: string; onBlank: () => void; onWrite: (direction: string) => Promise<void> }) {
  const [direction, setDirection] = useState("");
  const [busyNow, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Extend the film" subtitle="The director writes the next beat, picking up from the exact last moment, or add a blank beat and write the shots yourself." icon={<Plus className="h-4 w-4" />} />
      <div className="grid gap-2 p-5 sm:grid-cols-[1fr_auto_auto]">
        <Input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="What happens next (optional): Dre watches from the car across the street" />
        <Button variant="primary" loading={busyNow} onClick={async () => { setBusy(true); await onWrite(direction); setDirection(""); setBusy(false); }}><Wand2 className="h-4 w-4" /> Write next beat · {price}</Button>
        <Button variant="secondary" onClick={onBlank}>Blank beat</Button>
      </div>
    </Card>
  );
}
