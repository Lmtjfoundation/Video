"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenText, Copy, Download, FileText, Lock, Repeat2, Send, Trash2, Upload } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard } from "@/lib/client";
import { NICHES, STORY_FORMATS, STORY_TYPES } from "@/lib/niches";
import { CREDIT_COST, storyCredits } from "@/lib/plans";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import type { MediaItem, Platform, Story } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { RepurposeDialog } from "@/components/repurpose-dialog";

type Src = { name: string; text: string };
type MediaWithUrl = MediaItem & { url: string };

function storyMarkdown(st: Story) {
  const o = st.out;
  return [
    `# ${o.titles?.[0]?.title ?? st.topic}`,
    o.label ? `(${o.label})` : "",
    `Niche: ${st.niche} · ${STORY_FORMATS[st.format].label} · ${STORY_TYPES[st.type]}`,
    "",
    "## Title options",
    ...(o.titles ?? []).map((t) => `- ${t.title} — ${t.why ?? ""}`),
    "",
    `## Hook\n${o.hook ?? ""}`,
    "",
    "## Scenes",
    ...o.scenes.map((s) => `[${s.time ?? ""}] ${s.narration}\n  On screen: ${s.onScreen ?? "—"}\n  Visual: ${s.visual ?? "—"}\n  Audio: ${s.audio ?? "—"}`),
    "",
    `## Ending\n${o.ending ?? ""}`,
    `\n## CTA\n${o.cta ?? ""}`,
    `\n## Description\n${o.description ?? ""}`,
    `\nTags: ${(o.tags ?? []).join(", ")}`,
    "",
    "## Verify before publishing",
    ...(o.factCheck ?? []).map((x) => `- ${x}`),
  ].join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StoryStudio() {
  const { status, toast, refresh } = useApp();
  const plan = status?.me.plan;
  const [f, setF] = useState({ niche: "edu", customNiche: "", topic: "", type: "true" as Story["type"], format: "short" as Story["format"], tone: "Gripping and suspenseful", voice: "Third-person documentary" });
  const [sources, setSources] = useState<Src[]>([]);
  const [media, setMedia] = useState<MediaWithUrl[]>([]);
  const [refs, setRefs] = useState<string[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repurposeFor, setRepurposeFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api<Story[]>("/api/stories"), api<{ items: MediaWithUrl[] }>("/api/media")]);
      setStories(s);
      setMedia(m.items.filter((x) => x.kind === "image"));
      setCurrent((c) => c ?? s[0]?.id ?? null);
    } catch {
      /* shown elsewhere */
    }
  }, []);

  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    const niche = q.get("niche");
    if (niche) setF((x) => ({ ...x, niche, customNiche: q.get("custom") ?? "", topic: q.get("topic") ?? "", type: (q.get("type") as Story["type"]) ?? x.type, tone: q.get("type") === "funny" ? "Deadpan and witty — the facts are the joke" : x.tone }));
  }, [load]);

  const long = f.format === "long";
  const longLocked = long && !plan?.features.longStories;
  const cost = plan ? storyCredits(plan, long) : long ? CREDIT_COST.storyLong : CREDIT_COST.storyShort;
  const st = stories.find((s) => s.id === current) ?? null;

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Src[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 2_000_000 || !/\.(txt|md|csv|srt|vtt|json)$/i.test(file.name)) {
        toast(`${file.name}: use a text file under 2 MB (.txt .md .csv .srt .vtt .json).`, "error");
        continue;
      }
      next.push({ name: file.name, text: (await file.text()).slice(0, 60_000) });
    }
    setSources((s) => [...s, ...next].slice(0, 10));
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).slice(0, 3).forEach((x) => fd.append("files", x));
    const res = await fetch("/api/media", { method: "POST", body: fd });
    const data = (await res.json()) as { saved?: MediaWithUrl[]; errors?: string[]; error?: string };
    if (!res.ok) return toast(data.error ?? "Upload failed", "error");
    data.errors?.forEach((e) => toast(e, "error"));
    const imgs = (data.saved ?? []).filter((x) => x.kind === "image");
    setMedia((m) => [...imgs, ...m]);
    setRefs((r) => [...r, ...imgs.map((x) => x.id)].slice(0, 3));
  }

  async function write() {
    setBusy(true);
    try {
      const s = await api<Story>("/api/stories", { body: { ...f, sources, mediaIds: refs } });
      setStories((x) => [s, ...x]);
      setCurrent(s.id);
      toast("Story script ready", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Story Studio" subtitle="Faceless story scripts built for retention: hook, scene-by-scene narration, on-screen text, visuals to source, titles and a fact-check list." />
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Card className="h-fit xl:sticky xl:top-10">
          <CardHeader title="New story" subtitle={status ? `${status.me.creditsLeft} credits left · this costs ${cost}` : undefined} icon={<BookOpenText className="h-4 w-4" />} />
          <div className="grid gap-4 p-5">
            <Field label="Niche">
              <Select value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })}>
                {NICHES.filter((n) => n.id !== "kids").map((n) => <option key={n.id} value={n.id}>{n.name} · ${n.rpm.toFixed(2)} RPM</option>)}
                <option value="custom">Custom niche…</option>
              </Select>
            </Field>
            {f.niche === "custom" && <Input value={f.customNiche} onChange={(e) => setF({ ...f, customNiche: e.target.value })} placeholder="Describe your niche" aria-label="Custom niche" />}
            <Field label="Story idea" hint="optional">
              <Textarea value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="e.g. The 1983 Gimli Glider: a jet runs out of fuel at 41,000 feet" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Story type">
                <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Story["type"] })}>
                  {Object.entries(STORY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.split(" — ")[0]}</option>)}
                </Select>
              </Field>
              <Field label="Format">
                <Select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as Story["format"] })}>
                  {Object.entries(STORY_FORMATS).map(([k, v]) => <option key={k} value={k}>{v.label.split(" · ")[0]}</option>)}
                </Select>
              </Field>
            </div>
            <p className="-mt-2 text-xs text-white/45">{STORY_TYPES[f.type]} · {STORY_FORMATS[f.format].note}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tone">
                <Select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}>{["Gripping and suspenseful", "Curious and investigative", "Deadpan and witty — the facts are the joke", "Calm documentary", "Fast and punchy"].map((x) => <option key={x}>{x}</option>)}</Select>
              </Field>
              <Field label="Narrator">
                <Select value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })}>{["Third-person documentary", "Second person (you)", "First-person fictional narrator"].map((x) => <option key={x}>{x}</option>)}</Select>
              </Field>
            </div>

            <div className="grid gap-2">
              <span className="text-[13px] font-medium text-white/80">Your source material <span className="font-normal text-white/40">· optional</span></span>
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-white/15 bg-ink-900/60 p-4 text-center hover:border-mint-400/60">
                <FileText className="h-5 w-5 text-mint-300" />
                <span className="text-sm text-white/80">Add notes, research or transcripts</span>
                <span className="text-xs text-white/40">.txt .md .csv .srt .vtt .json</span>
                <input type="file" multiple accept=".txt,.md,.csv,.srt,.vtt,.json,text/plain" className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
              {sources.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ring-1 ring-white/[0.06]">
                  <Badge tone="sky">text</Badge><span className="min-w-0 flex-1 truncate">{s.name}</span><span className="text-xs tabular-nums text-white/40">{s.text.length.toLocaleString()} chars</span>
                  <button className="text-xs text-white/40 hover:text-white" onClick={() => setSources((x) => x.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <span className="mt-1 text-[13px] font-medium text-white/80">Reference images <span className="font-normal text-white/40">· up to 3</span></span>
              <div className="flex flex-wrap gap-2">
                {media.slice(0, 12).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setRefs((r) => (r.includes(m.id) ? r.filter((x) => x !== m.id) : [...r, m.id].slice(0, 3)))}
                    className={cn("focus-ring relative h-14 w-14 overflow-hidden rounded-lg ring-2", refs.includes(m.id) ? "ring-mint-400" : "ring-transparent opacity-70 hover:opacity-100")}
                    title={m.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                  </button>
                ))}
                <label className="grid h-14 w-14 cursor-pointer place-items-center rounded-lg border border-dashed border-white/15 text-white/50 hover:border-mint-400/60" title="Upload images">
                  <Upload className="h-4 w-4" />
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { uploadImages(e.target.files); e.target.value = ""; }} />
                </label>
              </div>
              <p className="text-xs text-white/40">For true stories, Claude sticks to your sources plus well-established facts.</p>
            </div>

            {longLocked ? (
              <Link href="/plans"><Button variant="gold" size="lg" className="w-full"><Lock className="h-4 w-4" /> Long scripts are included from Pro</Button></Link>
            ) : (
              <Button variant="primary" size="lg" loading={busy} onClick={write}>{busy ? "Writing… (long scripts take up to a minute)" : `Write story · ${cost} credits`}</Button>
            )}
          </div>
        </Card>

        <div className="grid min-w-0 gap-6">
          {st ? (
            <StoryView
              st={st}
              onPost={async () => {
                try {
                  const p = await api<{ platform: Platform }>("/api/stories/to-post", { body: { id: st.id } });
                  toast(`Saved as a ${PLATFORM_SPECS[p.platform].name} draft in Content Studio.`, "success");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
              onRepurpose={() => setRepurposeFor(st.id)}
              onDelete={async () => {
                await api(`/api/stories?id=${st.id}`, { method: "DELETE" });
                setStories((x) => x.filter((y) => y.id !== st.id));
                setCurrent(null);
              }}
            />
          ) : (
            <Card><Empty icon={<BookOpenText className="h-6 w-6" />} title="No story yet" body="Pick a niche and press Write story, or start from a Niche Lab idea." action={<Link href="/niche"><Button>Open Niche Lab</Button></Link>} /></Card>
          )}
          {stories.length > 0 && (
            <Card>
              <CardHeader title="Library" subtitle={`${stories.length} saved scripts`} />
              <ul className="divide-y divide-white/[0.05]">
                {stories.slice(0, 30).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <Badge>{STORY_FORMATS[s.format].label.split(" · ")[0]}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{s.out.titles?.[0]?.title ?? s.topic ?? "Untitled"}</p>
                      <p className="text-xs text-white/45">{s.niche} · {new Date(s.createdAt).toLocaleDateString()}</p>
                    </div>
                    <Button size="sm" variant={s.id === current ? "primary" : "secondary"} onClick={() => setCurrent(s.id)}>{s.id === current ? "Open" : "View"}</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {repurposeFor && <RepurposeDialog storyId={repurposeFor} onClose={() => setRepurposeFor(null)} />}
    </>
  );
}

function StoryView({ st, onPost, onRepurpose, onDelete }: { st: Story; onPost: () => void; onRepurpose: () => void; onDelete: () => void }) {
  const toast = useApp((s) => s.toast);
  const [confirm, setConfirm] = useState(false);
  const o = st.out;
  const narration = o.scenes.map((s) => s.narration).filter(Boolean).join("\n\n");
  return (
    <Card>
      <CardHeader title={o.titles?.[0]?.title ?? st.topic} subtitle={`${st.niche} · ${STORY_FORMATS[st.format].label} · ${STORY_TYPES[st.type]}${o.runtimeSec ? ` · ~${o.runtimeSec}s` : ""}${o.label ? ` · ${o.label}` : ""}`} />
      <div className="grid gap-5 p-5">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={async () => toast((await copyToClipboard(narration)) ? "Voiceover copied" : "Copy blocked", "success")}><Copy className="h-3.5 w-3.5" /> Copy voiceover</Button>
          <Button size="sm" onClick={async () => toast((await copyToClipboard(storyMarkdown(st))) ? "Script copied" : "Copy blocked", "success")}><Copy className="h-3.5 w-3.5" /> Copy full script</Button>
          <Button size="sm" onClick={() => download(`story-${(o.titles?.[0]?.title ?? "script").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.md`, storyMarkdown(st))}><Download className="h-3.5 w-3.5" /> Export .md</Button>
          <Button size="sm" variant="gold" onClick={onPost}><Send className="h-3.5 w-3.5" /> Save as draft post</Button>
          <Button size="sm" onClick={onRepurpose}><Repeat2 className="h-3.5 w-3.5" /> Repurpose everywhere</Button>
          <Button size="sm" variant="danger" className="ml-auto" onClick={() => (confirm ? onDelete() : (setConfirm(true), setTimeout(() => setConfirm(false), 3500)))}><Trash2 className="h-3.5 w-3.5" /> {confirm ? "Confirm" : ""}</Button>
        </div>
        <div>
          <p className="label mb-2">Title options</p>
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">{(o.titles ?? []).map((t) => <li key={t.title}><span className="font-medium text-white">{t.title}</span> <span className="text-white/45">{t.why}</span></li>)}</ol>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-mint-400/10 to-gold-400/[0.06] p-4 ring-1 ring-mint-400/25">
          <p className="label mb-1.5">Hook · first 3 seconds</p>
          <p className="text-[17px] font-semibold leading-snug text-white">{o.hook}</p>
        </div>
        <div>
          <p className="label mb-2">Storyboard</p>
          <div className="grid gap-2">
            {o.scenes.map((s, i) => (
              <div key={i} className="grid grid-cols-[52px_1fr] gap-3 rounded-xl bg-ink-900/70 p-3 ring-1 ring-white/[0.06]">
                <span className="pt-0.5 font-mono text-xs text-mint-300">{s.time ?? i + 1}</span>
                <div className="min-w-0">
                  <p className="text-[14px] leading-relaxed text-white/90">{s.narration}</p>
                  <div className="mt-2 grid gap-1 text-xs text-white/50">
                    {s.onScreen && <span><b className="text-white/70">On screen</b> {s.onScreen}</span>}
                    {s.visual && <span><b className="text-white/70">Visual</b> {s.visual}</span>}
                    {s.audio && <span><b className="text-white/70">Audio</b> {s.audio}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div><p className="label mb-1.5">Ending</p><p className="text-white/80">{o.ending}</p><p className="label mb-1.5 mt-3">Call to action</p><p className="text-white/80">{o.cta}</p></div>
          <div><p className="label mb-1.5">Thumbnail text</p><div className="flex flex-wrap gap-1.5">{(o.thumbnailText ?? []).map((x) => <Badge key={x} tone="gold">{x}</Badge>)}</div><p className="label mb-1.5 mt-3">Pinned comment</p><p className="text-white/80">{o.pinnedComment}</p></div>
        </div>
        <div><p className="label mb-1.5">Description</p><pre className="whitespace-pre-wrap rounded-xl bg-ink-950/60 p-3 font-sans text-sm text-white/80 ring-1 ring-white/[0.05]">{o.description}{"\n\n"}{(o.tags ?? []).map((t) => "#" + String(t).replace(/^#/, "").replace(/\s+/g, "")).join(" ")}</pre></div>
        {(o.factCheck ?? []).length > 0 && (
          <div className="rounded-xl bg-gold-400/[0.06] p-4 text-sm text-gold-300 ring-1 ring-gold-400/25">
            <p className="font-medium">Verify before publishing</p>
            <ul className="mt-1.5 list-disc pl-5 text-gold-300/90">{o.factCheck!.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {o.monetization && <p className="text-sm text-white/60"><span className="text-gold-300">Monetization:</span> {o.monetization}</p>}
        {st.sources.length > 0 && <p className="text-xs text-white/40">Sources used: {st.sources.join(", ")}</p>}
      </div>
    </Card>
  );
}
