"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Clapperboard, ListVideo, Save, Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Switch, Textarea } from "@/components/ui";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { PLATFORMS, type Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

type Episode = { n: number; title: string; outline: string; hook: string; postId?: string; made: { status: string; message: string } | null };
type Series = { id: string; title: string; logline: string; bible: string; characterIds: string[]; look: string; platform: Platform; length: string; episodes: Episode[] };
type Data = {
  series: Series[];
  characters: { id: string; name: string; imageUrl: string }[];
  lookGroups: { label: string; looks: string[] }[];
  lengths: { id: string; label: string }[];
  credits: { plan: number };
  limits: { min: number; max: number };
};

export default function SeriesStudio() {
  const { toast, refresh } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [premise, setPremise] = useState("");
  const [episodes, setEpisodes] = useState(10);
  const [cast, setCast] = useState<string[]>([]);
  const [look, setLook] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [length, setLength] = useState("m3");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/api/series");
      setData(d);
      setOpen((o) => o ?? d.series[0]?.id ?? null);
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
  // Refresh while an episode is rendering.
  useEffect(() => {
    if (!data?.series.some((s) => s.episodes.some((e) => e.made && (e.made.status === "queued" || e.made.status === "rendering")))) return;
    const t = setTimeout(load, 8000);
    return () => clearTimeout(t);
  }, [data, load]);

  async function plan() {
    setBusy(true);
    try {
      const s = await api<Series>("/api/series", { body: { premise, episodes, characterIds: cast, look: look || undefined, platform, length } });
      toast(`“${s.title}” planned: ${s.episodes.length} episodes`, "success");
      setOpen(s.id);
      setPremise("");
      await load();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const current = data?.series.find((s) => s.id === open) ?? null;

  return (
    <>
      <PageHeader title="Series Studio" subtitle="Plan a whole series once, with a story bible, a recurring cast and every episode outlined. Then make each episode with the same characters and continuity." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <div className="grid grid-cols-1 h-fit gap-6">
          <Card>
            <CardHeader title="New series" subtitle="A sentence is enough, or paste a full story bible." icon={<BookOpen className="h-4 w-4" />} />
            <div className="grid grid-cols-1 gap-4 p-5">
              <Field label="The story" hint={`${premise.length.toLocaleString()} / 20,000`}>
                <Textarea value={premise} onChange={(e) => setPremise(e.target.value.slice(0, 20000))} placeholder="e.g. A Houston family drama: Tasha pulled Marcus out of the streets twelve years ago. Now she wants something of her own, and his old partner Dre is using her to drain them…" className="min-h-[160px]" />
              </Field>
              {!!data?.characters.length && (
                <div>
                  <span className="mb-1.5 block text-[13px] font-medium text-white/80">Recurring cast <span className="font-normal text-white/40">· up to 6</span></span>
                  <div className="flex flex-wrap gap-2">
                    {data.characters.map((c) => (
                      <button key={c.id} onClick={() => setCast((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id].slice(0, 6)))} className={cn("focus-ring flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs ring-1", cast.includes(c.id) ? "bg-mint-400/15 text-mint-100 ring-mint-400/50" : "bg-white/[0.03] text-white/60 ring-white/10")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.imageUrl} alt="" className="h-7 w-7 rounded-full object-cover object-top" />
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Episodes">
                  <Input type="number" min={data?.limits.min ?? 3} max={data?.limits.max ?? 20} value={episodes} onChange={(e) => setEpisodes(Number(e.target.value))} />
                </Field>
                <Field label="Episode length">
                  <Select value={length} onChange={(e) => setLength(e.target.value)}>
                    {data?.lengths.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Platform">
                  <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                    {PLATFORMS.filter((p) => p !== "webhook").map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}
                  </Select>
                </Field>
                <Field label="Art style">
                  <Select value={look} onChange={(e) => setLook(e.target.value)}>
                    <option value="">The cast&apos;s style</option>
                    {data?.lookGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.looks.map((l) => <option key={l} value={l}>{l.split(",")[0]}</option>)}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button variant="primary" size="lg" loading={busy} disabled={busy || premise.trim().length < 20} onClick={plan}>
                <ListVideo className="h-4 w-4" /> {busy ? "Planning the series…" : `Plan the series · ${data?.credits.plan ?? 10} credits`}
              </Button>
            </div>
          </Card>
          {!!data?.series.length && (
            <Card className="p-2">
              {data.series.map((s) => (
                <button key={s.id} onClick={() => setOpen(s.id)} className={cn("focus-ring flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm", open === s.id ? "bg-white/[0.07] text-white" : "text-white/60 hover:text-white")}>
                  <span className="truncate">{s.title}</span>
                  <span className="text-xs text-white/40">{s.episodes.filter((e) => e.postId).length}/{s.episodes.length}</span>
                </button>
              ))}
            </Card>
          )}
        </div>
        <div className="min-w-0">
          {current ? <SeriesView key={current.id} s={current} onChange={load} /> : (
            <Card>
              <Empty icon={<ListVideo className="h-6 w-6" />} title="No series yet" body="Describe your story on the left. You'll get a story bible and an outline for every episode, which you can edit before making each one." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SeriesView({ s, onChange }: { s: Series; onChange: () => void }) {
  const { toast, refresh } = useApp();
  const [bible, setBible] = useState(s.bible);
  const [making, setMaking] = useState<number | null>(null);
  const [renderNow, setRenderNow] = useState(true);

  async function saveBible() {
    try {
      await api("/api/series", { method: "PATCH", body: { id: s.id, bible } });
      toast("Bible saved", "success");
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function make(n: number) {
    setMaking(n);
    try {
      await api("/api/series/episode", { body: { id: s.id, n, renderNow, background: true } });
      jobStarted();
      toast(`Episode ${n} is being made in the background. Keep working, or leave the page: we'll tell you when it's ready.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setMaking(null);
    }
  }
  async function remove() {
    if (!confirm(`Delete “${s.title}”? Episodes already made stay in Content Studio.`)) return;
    await api(`/api/series?id=${s.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "error"));
    onChange();
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader title={s.title} subtitle={s.logline} icon={<BookOpen className="h-4 w-4" />} action={<Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-3.5 w-3.5" /></Button>} />
        <div className="grid grid-cols-1 gap-3 p-5">
          <Field label="Story bible" hint="every episode follows this">
            <Textarea value={bible} onChange={(e) => setBible(e.target.value.slice(0, 6000))} className="min-h-[160px] text-[13px]" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-white/60">
              <Switch checked={renderNow} onChange={setRenderNow} label="Render episodes right away" /> Render episodes right away
            </div>
            <Button size="sm" disabled={bible === s.bible} onClick={saveBible}><Save className="h-3.5 w-3.5" /> Save bible</Button>
          </div>
        </div>
      </Card>
      {s.episodes.map((e) => <EpisodeCard key={e.n} s={s} e={e} making={making === e.n} disabled={making !== null} onMake={() => make(e.n)} onSaved={onChange} />)}
    </div>
  );
}

function EpisodeCard({ s, e, making, disabled, onMake, onSaved }: { s: Series; e: Episode; making: boolean; disabled: boolean; onMake: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [outline, setOutline] = useState(e.outline);
  const [hook, setHook] = useState(e.hook);
  const [edit, setEdit] = useState(false);
  const status = e.made?.status;
  async function save() {
    try {
      await api("/api/series", { method: "PATCH", body: { id: s.id, episode: { n: e.n, outline, hook } } });
      setEdit(false);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Episode {e.n}</p>
          <p className="text-lg font-semibold text-white">{e.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {status && <Badge tone={status === "done" ? "mint" : status === "failed" ? "red" : "gold"}>{status === "plan" ? "written" : status}</Badge>}
          {e.postId && <Link href={`/post/${e.postId}`}><Button size="sm" variant="ghost">Open</Button></Link>}
          <Button size="sm" variant={e.postId ? "ghost" : "primary"} loading={making} disabled={disabled} onClick={onMake}>
            <Clapperboard className="h-3.5 w-3.5" /> {e.postId ? "Make again" : "Make episode"}
          </Button>
        </div>
      </div>
      {edit ? (
        <div className="mt-3 grid grid-cols-1 gap-3">
          <Textarea value={outline} onChange={(x) => setOutline(x.target.value.slice(0, 3000))} className="min-h-[140px] text-[13px]" />
          <Field label="Ends on">
            <Input value={hook} onChange={(x) => setHook(x.target.value.slice(0, 400))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button>
            <Button size="sm" onClick={save}><Save className="h-3.5 w-3.5" /> Save</Button>
          </div>
        </div>
      ) : (
        <button className="mt-2 w-full text-left" onClick={() => setEdit(true)} title="Edit the outline">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/70">{e.outline}</p>
          {e.hook && <p className="mt-2 text-[13px] text-gold-200/80">Ends on: {e.hook}</p>}
        </button>
      )}
      {e.made?.message && status !== "done" && <p className="mt-2 text-xs text-white/45">{e.made.message}</p>}
    </Card>
  );
}
