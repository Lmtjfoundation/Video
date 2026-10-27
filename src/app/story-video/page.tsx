"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Download, FileText, Globe, ImageIcon, Lightbulb, Mic, PenLine, Rocket, SlidersHorizontal } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { MediaSelect, useMedia } from "@/components/voice-tools";
import { VoicePicker } from "@/components/voice-picker";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import type { StorySourceKind, StoryTemplate } from "@/lib/story-templates";
import type { VoiceChoice } from "@/lib/voice-catalog";

type Story = { id: string; title: string; template: string; language: string; scenes: number; render: { status: string; progress: number; message: string } | null; videoUrl: string | null; thumbnailUrl: string | null; createdAt: string };
type Data = {
  stories: Story[];
  templates: StoryTemplate[];
  lookGroups: { label: string; looks: readonly string[] }[];
  languages: Record<string, string>;
  engine: boolean;
  characters: { id: string; name: string; imageUrl: string }[];
  credits: { estimate: Record<string, { plan: number; render: number; speech: number }>; thumbnail: number };
};

const SOURCES: { id: StorySourceKind; label: string; icon: typeof Lightbulb; hint: string }[] = [
  { id: "idea", label: "Idea", icon: Lightbulb, hint: "A sentence or two. Ghost Post writes the story." },
  { id: "script", label: "Script", icon: PenLine, hint: "Your words, narrated as written." },
  { id: "media", label: "Audio or video", icon: Mic, hint: "A podcast, voice note or video: its words become the story." },
  { id: "link", label: "Web link", icon: Globe, hint: "An article or page: its facts become the story." },
  { id: "file", label: "Text file", icon: FileText, hint: ".txt, .md, .srt or .vtt" },
];
const LENGTHS = [["s30", "About 30 seconds"], ["s60", "About 1 minute"], ["s90", "About 90 seconds"], ["m3", "About 3 minutes"]] as const;

export default function StoryVideo() {
  const { toast, refresh } = useApp();
  const { items } = useMedia();
  const [data, setData] = useState<Data | null>(null);
  const [template, setTemplate] = useState("general");
  const [kind, setKind] = useState<StorySourceKind>("idea");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [fileName, setFileName] = useState("");
  const [language, setLanguage] = useState("en");
  const [second, setSecond] = useState("es");
  const [narrator, setNarrator] = useState<VoiceChoice>({ kind: "free", id: "bm_fable", speed: 1 });
  const [cast, setCast] = useState<string[]>([]);
  const [look, setLook] = useState("");
  const [platform, setPlatform] = useState("youtube");
  const [length, setLength] = useState("");
  const [instant, setInstant] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Data>("/api/story-video").then(setData).catch((e) => toast((e as Error).message, "error")), [toast]);
  useEffect(() => {
    load();
    window.addEventListener("ghostpost:job-done", load);
    const t = setInterval(load, 15_000);
    return () => {
      window.removeEventListener("ghostpost:job-done", load);
      clearInterval(t);
    };
  }, [load]);

  const t = data?.templates.find((x) => x.id === template);
  const len = length || t?.length || "s90";
  // Other languages are spoken on the engine: switch the narrator over when needed.
  useEffect(() => {
    if (language !== "en" && narrator.kind === "free") setNarrator({ kind: "engine", language });
    else if (narrator.kind === "engine" && narrator.language !== language) setNarrator({ ...narrator, language });
  }, [language, narrator]);
  const e = data?.credits.estimate[len];
  const estimate = e ? e.plan + (instant ? e.render + (narrator.kind === "engine" ? e.speech : 0) : 0) : 0;
  const ready = kind === "idea" || kind === "script" || kind === "file" ? text.trim().length >= (kind === "idea" ? 3 : 20) : kind === "link" ? /^https?:\/\/\S+\.\S+/.test(url.trim()) : !!mediaId;

  async function start() {
    setBusy(true);
    try {
      await api("/api/story-video", {
        body: { action: "start", template, source: { kind, text, url, mediaId, fileName }, language, secondLanguage: t?.bilingual ? second : undefined, narrator, characterIds: cast, look: look || undefined, platform, length: len, instant },
      });
      jobStarted();
      toast(instant ? "Writing and rendering your story. Follow it in the tray; it appears below when it's ready." : "Writing the storyboard. The tray opens it in the Director when it's ready.", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function readFile(f: File) {
    if (f.size > 2_000_000) return toast("Use a text file under 2 MB.", "error");
    if (!/\.(txt|md|markdown|srt|vtt|text)$/i.test(f.name)) return toast("Use a .txt, .md, .srt or .vtt file. For a PDF or Word file, copy its text into Script.", "error");
    let s = await f.text();
    // Captions: keep only the words.
    if (/\.(srt|vtt)$/i.test(f.name)) s = s.split("\n").filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/.test(l)).join(" ");
    setText(s.slice(0, 20_000));
    setFileName(f.name);
  }

  return (
    <>
      <PageHeader title="Story to Video" subtitle="A whole narrated video from an idea, a script, a recording, a web page or a file: storyboard, pictures, voice, music and captions, in 23 languages. Then change any scene in the Director." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-w-0">
          <CardHeader title="New story" subtitle={t?.blurb} icon={<BookOpen className="h-4 w-4" />} />
          <div className="grid grid-cols-1 gap-5 p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data?.templates.map((x) => (
                <button key={x.id} onClick={() => { setTemplate(x.id); setLength(""); }} className={cn("rounded-xl border p-2.5 text-left", template === x.id ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")}>
                  <div className="text-sm font-medium">{x.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-white/50">{x.blurb}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="flex flex-wrap gap-1.5">
                {SOURCES.map((s) => (
                  <button key={s.id} onClick={() => setKind(s.id)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium", kind === s.id ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>
                    <s.icon className="h-3.5 w-3.5" /> {s.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-white/50">{SOURCES.find((s) => s.id === kind)!.hint}</p>
              {(kind === "idea" || kind === "script") && (
                <Textarea rows={kind === "idea" ? 4 : 9} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} placeholder={kind === "idea" ? "e.g. A shy lighthouse keeper finds a message in a bottle from her younger self" : "Paste your script. Each paragraph becomes about one scene."} />
              )}
              {kind === "link" && <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />}
              {kind === "media" && <MediaSelect items={items} kinds={["audio", "video"]} value={mediaId} onChange={setMediaId} empty="Upload a recording or video to the Media Library first" />}
              {kind === "file" && (
                <div className="grid grid-cols-1 gap-2">
                  <input type="file" accept=".txt,.md,.markdown,.srt,.vtt,text/plain,text/markdown" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white" />
                  {fileName && <p className="text-xs text-white/50">{fileName}: {text.length.toLocaleString()} characters</p>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Story language">
                <Select value={language} onChange={(e) => setLanguage(e.target.value)}>{Object.entries(data?.languages ?? { en: "English" }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
              {t?.bilingual ? (
                <Field label="Second language">
                  <Select value={second} onChange={(e) => setSecond(e.target.value)}>{Object.entries(data?.languages ?? {}).filter(([k]) => k !== language).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                </Field>
              ) : (
                <Field label="Length">
                  <Select value={len} onChange={(e) => setLength(e.target.value)}>{LENGTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                </Field>
              )}
            </div>
            <Field label="Narrator" hint={language !== "en" ? "other languages speak on the engine" : undefined}>
              <VoicePicker value={narrator} onChange={(v) => setNarrator(v.kind === "engine" ? { ...v, language } : v)} languages={{ [language]: data?.languages[language] ?? "English" }} />
            </Field>

            {!!data?.characters.length && (
              <Field label="Characters" hint="optional · up to 6, faces kept in every scene">
                <div className="flex flex-wrap gap-2">
                  {data.characters.map((c) => (
                    <button key={c.id} onClick={() => setCast((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id].slice(0, 6)))} className={cn("focus-ring flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs ring-1", cast.includes(c.id) ? "bg-mint-400/15 text-mint-100 ring-mint-400/50" : "bg-white/[0.03] text-white/60 ring-white/10")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.imageUrl} alt="" className="h-7 w-7 rounded-full object-cover object-top" />
                      {c.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Style">
                <Select value={look} onChange={(e) => setLook(e.target.value)}>
                  <option value="">{t ? `Template style: ${t.look.split(",")[0]}` : "Template style"}</option>
                  {data?.lookGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.looks.map((l) => <option key={l} value={l}>{l.split(",")[0]}</option>)}</optgroup>)}
                </Select>
              </Field>
              <Field label="For">
                <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>{(["youtube", "tiktok", "instagram", "facebook", "x"] as const).map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}</Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([[true, "Instant", "Write it and render the video in one go.", Rocket], [false, "Director mode", "Review the storyboard, change any scene or camera move, then render.", SlidersHorizontal]] as const).map(([v, title, d, Icon]) => (
                <button key={title} onClick={() => setInstant(v)} className={cn("rounded-xl border p-3 text-left", instant === v ? "border-mint-400 bg-mint-400/10" : "border-white/10 bg-white/[0.03]")}>
                  <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" /> {title}</div>
                  <div className="mt-1 text-xs text-white/55">{d}</div>
                </button>
              ))}
            </div>
            {data && !data.engine && <div className="rounded-xl border border-gold-300/30 bg-gold-300/10 p-3 text-xs text-white/75">Story pictures are painted on Ghost Post&apos;s engine (a GPU), which isn&apos;t connected yet. The admin connects it in Admin → App settings → Integrations.</div>}
            <Button variant="primary" size="lg" loading={busy} disabled={!ready || busy} onClick={start}>
              {instant ? "Make the video" : "Write the storyboard"} · up to {estimate} credits
            </Button>
          </div>
        </Card>

        <div className="grid grid-cols-1 h-fit gap-4">
          <h2 className="text-sm font-semibold text-white/80">Your stories</h2>
          {!data?.stories.length && <Card className="p-5 text-sm text-white/50">Stories you make appear here, with their video, thumbnail and story package.</Card>}
          {data?.stories.map((s) => (
            <Card key={s.id} className="min-w-0 overflow-hidden">
              {s.videoUrl ? <video src={s.videoUrl} poster={s.thumbnailUrl ?? undefined} controls playsInline className="max-h-96 w-full bg-black" /> : s.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumbnailUrl} alt="" className="max-h-64 w-full object-cover" />
              ) : null}
              <div className="grid grid-cols-1 gap-2 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="text-xs text-white/50">{data.templates.find((x) => x.id === s.template)?.name} · {data.languages[s.language] ?? s.language} · {s.scenes} scenes</div>
                  </div>
                  {s.render && <Badge tone={s.render.status === "done" ? "mint" : s.render.status === "failed" ? "red" : "gold"}>{s.render.status === "rendering" ? `${s.render.progress}%` : s.render.status}</Badge>}
                </div>
                {s.render && s.render.status !== "done" && <p className="text-xs text-white/50">{s.render.message}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <Link href={`/director?id=${s.id}`}><Button size="sm"><SlidersHorizontal className="h-3.5 w-3.5" /> Edit scenes</Button></Link>
                  <Button size="sm" onClick={async () => {
                    try {
                      const r = await api<{ credits: number }>("/api/story-video", { body: { action: "thumbnail", id: s.id } });
                      jobStarted();
                      toast(`Painting the thumbnail (${r.credits} credits)…`, "success");
                    } catch (e) {
                      toast((e as Error).message, "error");
                    }
                  }}><ImageIcon className="h-3.5 w-3.5" /> Thumbnail</Button>
                  <a href={`/api/story-video?package=${encodeURIComponent(s.id)}`}><Button size="sm"><Download className="h-3.5 w-3.5" /> Story package</Button></a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
