"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clapperboard, Copy, ImageIcon, MessageSquarePlus, Play, Save, Send, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Button, Card, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { PLATFORMS, type Platform, type VideoScene } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scene = VideoScene & { picture: string | null };
type Render = { status: string; progress: number; message?: string } | null;
type Open = {
  id: string;
  title: string;
  postId: string;
  messages: { role: "you" | "director"; text: string; at: string }[];
  video: { postId: string; title: string; scenes: Scene[]; render: Render; url: string | null; renderCredits: number } | null;
};
type Data = {
  sessions: { id: string; title: string; updatedAt: string }[];
  open: Open | null;
  characters: { id: string; name: string; imageUrl: string }[];
  pictures: { id: string; name: string; url: string }[];
  lookGroups: { label: string; looks: string[] }[];
  lengths: { id: string; label: string }[];
  credits: { change: number };
};

export default function Director() {
  const { toast, refresh } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cast, setCast] = useState<string[]>([]);
  const [look, setLook] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [length, setLength] = useState("s60");
  const chatEnd = useRef<HTMLDivElement>(null);
  /** The first message of a storyboard being written in the background. */
  const [writing, setWriting] = useState("");

  const load = useCallback(
    async (id?: string | null) => {
      try {
        const d = await api<Data>(`/api/director${id ? `?id=${id}` : ""}`);
        setData(d);
        if (d.open) setOpenId(d.open.id);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [toast],
  );
  useEffect(() => {
    // Opened from the jobs tray (/director?id=…) or the menu.
    const id = new URLSearchParams(window.location.search).get("id");
    load(id);
    const done = () => {
      setWriting("");
      setFresh(false);
      load(new URLSearchParams(window.location.search).get("id"));
    };
    window.addEventListener("ghostpost:job-done", done);
    return () => window.removeEventListener("ghostpost:job-done", done);
  }, [load]);
  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), [data?.open?.messages.length]);
  // Follow a render in progress.
  const rendering = data?.open?.video?.render && (data.open.video.render.status === "queued" || data.open.video.render.status === "rendering");
  useEffect(() => {
    if (!rendering) return;
    const t = setTimeout(() => load(openId), 5000);
    return () => clearTimeout(t);
  }, [rendering, data, load, openId]);

  const open = fresh ? null : data?.open ?? null;

  async function send() {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    try {
      if (!open) {
        // A new storyboard is written in the background; the jobs tray opens it when it's ready.
        await api("/api/director", { body: { message: text, characterIds: cast, look: look || undefined, platform, length, background: true } });
        setMessage("");
        setWriting(text);
        jobStarted();
        refresh();
        return;
      }
      const r = await api<{ id: string }>("/api/director", { body: { id: open.id, message: text } });
      setMessage("");
      await load(r.id);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function render() {
    if (!open?.video) return;
    try {
      await api("/api/video/render", { body: { id: open.video.postId } });
      toast("Rendering — the video appears here when it's ready", "success");
      await load(open.id);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHeader title="Director" subtitle="Make a video by talking. Describe it, then change anything by saying so, or edit the scenes on the timeline by hand." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-fit p-2">
          <Button className="mb-2 w-full" variant="primary" size="sm" onClick={() => setFresh(true)}>
            <MessageSquarePlus className="h-4 w-4" /> New video
          </Button>
          {data?.sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setFresh(false);
                load(s.id);
              }}
              className={cn("focus-ring block w-full truncate rounded-lg px-3 py-2 text-left text-sm", !fresh && openId === s.id ? "bg-white/[0.07] text-white" : "text-white/55 hover:text-white")}
            >
              {s.title}
            </button>
          ))}
        </Card>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          <Card className="flex min-h-[420px] flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto p-5" style={{ maxHeight: 460 }}>
              {writing && !open ? (
                <>
                  <div className="ml-auto max-w-[85%] whitespace-pre-line rounded-2xl bg-mint-400/15 px-4 py-2.5 text-sm text-mint-50">{writing}</div>
                  <div className="max-w-[85%] rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm text-white/85">
                    I&apos;m writing the storyboard in the background. You can keep working or leave this page; it opens here when it&apos;s ready.
                  </div>
                </>
              ) : open ? (
                open.messages.map((m, i) => (
                  <div key={i} className={cn("max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm", m.role === "you" ? "ml-auto bg-mint-400/15 text-mint-50" : "bg-white/[0.05] text-white/85")}>
                    {m.text}
                  </div>
                ))
              ) : (
                <div className="grid gap-4">
                  <p className="text-sm text-white/60">Describe the video: the story, who&apos;s in it, the mood. You can change everything afterwards just by saying so.</p>
                  {!!data?.characters.length && (
                    <div className="flex flex-wrap gap-2">
                      {data.characters.map((c) => (
                        <button key={c.id} onClick={() => setCast((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id].slice(0, 6)))} className={cn("focus-ring flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs ring-1", cast.includes(c.id) ? "bg-mint-400/15 text-mint-100 ring-mint-400/50" : "bg-white/[0.03] text-white/60 ring-white/10")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.imageUrl} alt="" className="h-7 w-7 rounded-full object-cover object-top" />
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Style">
                      <Select value={look} onChange={(e) => setLook(e.target.value)}>
                        <option value="">The cast&apos;s style</option>
                        {data?.lookGroups.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.looks.map((l) => <option key={l} value={l}>{l.split(",")[0]}</option>)}
                          </optgroup>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Platform">
                      <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                        {PLATFORMS.filter((p) => p !== "webhook").map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Length">
                      <Select value={length} onChange={(e) => setLength(e.target.value)}>
                        {data?.lengths.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div className="flex gap-2 border-t border-white/[0.06] p-3">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 4000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) send();
                  }
                }}
                placeholder={open ? "e.g. Make scene 3 darker and add Dre watching from the car" : "e.g. Marcus finds a second phone in Tasha's closet. Rainy night, tense, ends on the letter D."}
                className="min-h-[52px] flex-1"
              />
              <Button variant="primary" loading={busy} disabled={busy || !message.trim()} onClick={send} title={open ? `${data?.credits.change ?? 1} credit per change` : undefined}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </Card>

          {open?.video && <Timeline key={open.id + open.video.scenes.length + open.messages.length} open={open} pictures={data?.pictures ?? []} onSaved={() => load(open.id)} onRender={render} />}
          {!open && !data?.sessions.length && (
            <Card>
              <Empty icon={<Clapperboard className="h-6 w-6" />} title="Your first video starts with a sentence" body="Describe it above. The Director writes the storyboard with your characters, then you shape it together." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** The storyboard as a timeline: reorder, edit, swap a picture, duplicate or delete scenes, then render. */
function Timeline({ open, pictures, onSaved, onRender }: { open: Open; pictures: { id: string; name: string; url: string }[]; onSaved: () => void; onRender: () => void }) {
  const { toast } = useApp();
  const v = open.video!;
  const [scenes, setScenes] = useState<Scene[]>(v.scenes);
  const [sel, setSel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(scenes.map(strip)) !== JSON.stringify(v.scenes.map(strip));
  const busyRender = v.render && (v.render.status === "queued" || v.render.status === "rendering");

  const move = (i: number, d: number) => setScenes((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const n = [...s];
    [n[i], n[j]] = [n[j], n[i]];
    setSel(j);
    return n;
  });
  const patch = (i: number, p: Partial<Scene>) => setScenes((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));

  async function save() {
    setSaving(true);
    try {
      await api("/api/director", { method: "PUT", body: { id: open.id, scenes: scenes.map(strip) } });
      toast("Timeline saved", "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const s = sel !== null ? scenes[sel] : null;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">Timeline</p>
          <p className="text-sm text-white/60">{scenes.length} scenes · tap a scene to edit it</p>
        </div>
        <div className="flex gap-2">
          {dirty && <Button size="sm" variant="ghost" onClick={() => setScenes(v.scenes)}>Undo changes</Button>}
          <Button size="sm" loading={saving} disabled={!dirty || saving} onClick={save}><Save className="h-3.5 w-3.5" /> Save</Button>
          <Button size="sm" variant="primary" disabled={dirty || !!busyRender} onClick={onRender} title={dirty ? "Save the timeline first" : undefined}>
            <Play className="h-3.5 w-3.5" /> {busyRender ? `Rendering ${v.render?.progress ?? 0}%` : `Render · up to ${v.renderCredits} credits`}
          </Button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {scenes.map((x, i) => (
          <button key={i} onClick={() => setSel(i === sel ? null : i)} className={cn("focus-ring relative w-24 shrink-0 overflow-hidden rounded-lg text-left ring-2", sel === i ? "ring-mint-400" : "ring-white/10 hover:ring-white/30")}>
            <div className="grid aspect-[9/16] place-items-center bg-ink-900">
              {x.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.picture} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="px-1 text-center text-[10px] text-white/40">{x.visual.slice(0, 60)}</span>
              )}
            </div>
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-white">{i + 1}</span>
            <p className="line-clamp-2 p-1 text-[10px] leading-tight text-white/60">{x.narration || "(no words)"}</p>
          </button>
        ))}
      </div>
      {s && sel !== null && (
        <div className="mt-3 grid gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">Scene {sel + 1}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={sel === 0} onClick={() => move(sel, -1)} title="Move earlier"><ArrowLeft className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" disabled={sel === scenes.length - 1} onClick={() => move(sel, 1)} title="Move later"><ArrowRight className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => { setScenes((x) => [...x.slice(0, sel + 1), { ...s, mediaId: s.mediaId }, ...x.slice(sel + 1)]); setSel(sel + 1); }} title="Duplicate"><Copy className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" disabled={scenes.length < 2} onClick={() => { setScenes((x) => x.filter((_, k) => k !== sel)); setSel(null); }} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(null)} title="Close"><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <Field label="What's said">
            <Textarea value={s.narration} onChange={(e) => patch(sel, { narration: e.target.value })} className="min-h-[60px]" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="On-screen text">
              <Input value={s.onScreen} onChange={(e) => patch(sel, { onScreen: e.target.value })} />
            </Field>
            <Field label="Camera move">
              <Input value={s.motion} onChange={(e) => patch(sel, { motion: e.target.value })} />
            </Field>
          </div>
          <Field label="The shot" hint="changing it paints a new picture on the next render">
            <Textarea value={s.visual} onChange={(e) => patch(sel, { visual: e.target.value, picture: s.mediaId ? s.picture : null })} className="min-h-[60px]" />
          </Field>
          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-white/80"><ImageIcon className="h-3.5 w-3.5" /> Picture</span>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button onClick={() => patch(sel, { mediaId: undefined, picture: s.painted ? s.picture : null })} className={cn("focus-ring grid h-16 w-12 shrink-0 place-items-center rounded-lg text-center text-[10px] ring-2", !s.mediaId ? "ring-mint-400 text-mint-200" : "ring-white/10 text-white/50")}>AI</button>
              {pictures.map((p) => (
                <button key={p.id} onClick={() => patch(sel, { mediaId: p.id, picture: p.url })} title={p.name} className={cn("focus-ring h-16 w-12 shrink-0 overflow-hidden rounded-lg ring-2", s.mediaId === p.id ? "ring-mint-400" : "ring-transparent opacity-60 hover:opacity-100")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {v.render?.status === "failed" && <p className="mt-3 text-sm text-red-300">{v.render.message}</p>}
      {v.url && v.render?.status === "done" && (
        <div className="mt-4">
          <video src={v.url} controls playsInline className="mx-auto max-h-[70vh] rounded-xl" />
          <p className="mt-2 text-center text-xs text-white/45">{v.render.message}</p>
        </div>
      )}
    </Card>
  );
}

/** What the server stores for a scene (the preview link is only for the page). */
function strip({ picture: _p, ...s }: Scene): VideoScene {
  return s;
}
