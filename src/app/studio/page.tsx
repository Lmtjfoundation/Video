"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Download, FileText, FileUp, PenLine, Send, Sparkles, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { Format, MediaItem, Pillar, Platform, Post, PostStatus } from "@/lib/types";
import { CREDIT_COST } from "@/lib/plans";
import { PILLARS, PLATFORMS } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { FORMAT_LABEL, PILLAR_LABEL, cn } from "@/lib/utils";
import { Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Switch, Textarea } from "@/components/ui";
import { PostCard } from "@/components/post-card";
import { StarterButton } from "@/components/starter-button";
import { NICHES } from "@/lib/niches";
import { lengthAllowed, videoCredits, VIDEO_LENGTHS, VIDEO_STYLES, VIDEO_TARGET } from "@/lib/video-spec";
import type { VideoPlan } from "@/lib/types";
import { GENRES } from "@/lib/genres";

const FILTERS: { key: PostStatus | "all" | "video"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "video", label: "Videos" },
  { key: "draft", label: "Drafts" },
  { key: "pending_review", label: "In review" },
  { key: "rejected", label: "Sent back" },
  { key: "scheduled", label: "Scheduled" },
  { key: "copy_ready", label: "Copy-ready" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
];

export default function Studio() {
  const { status, toast, refresh } = useApp();
  const router = useRouter();
  const settings = status?.settings;
  const [kind, setKind] = useState<"text" | "video" | null>(null);
  const [vNiche, setVNiche] = useState("edu");
  const [vStyle, setVStyle] = useState<VideoPlan["style"]>("funny");
  const [vLen, setVLen] = useState<VideoPlan["length"]>("s60");
  const [platform, setPlatform] = useState<Platform>("x");
  const [pillar, setPillar] = useState<Pillar | "auto">("auto");
  const [format, setFormat] = useState<Format | "auto">("auto");
  const [count, setCount] = useState(1);
  const [topic, setTopic] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [mature, setMature] = useState(false);
  const [media, setMedia] = useState<(MediaItem & { url: string })[]>([]);
  const [attach, setAttach] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [genre, setGenre] = useState("");
  const [fromText, setFromText] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [faceless, setFaceless] = useState(true);
  const [renderNow, setRenderNow] = useState(false);
  useEffect(() => {
    if (settings) setFaceless(settings.faceless ?? true);
  }, [settings?.faceless]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api<{ items: (MediaItem & { url: string })[] }>("/api/media").then((r) => setMedia(r.items)).catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false);
  const [postingNow, setPostingNow] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<PostStatus | "all" | "video">("all");
  const inFilter = (p: Post, f: PostStatus | "all" | "video") => f === "all" || (f === "video" ? p.kind === "video" : p.status === f);
  useEffect(() => {
    if (!lengthAllowed(vLen, platform)) setVLen("s60");
  }, [platform, vLen]);
  const videoCost = count * videoCredits(vLen, "plan");
  const [sort, setSort] = useState<"new" | "money">("new");

  const load = useCallback(async () => {
    try {
      setPosts(await api<Post[]>("/api/posts"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const formats = PLATFORM_SPECS[platform].formats;
  useEffect(() => {
    if (format !== "auto" && !formats.includes(format)) setFormat("auto");
  }, [platform, format, formats]);

  const shown = useMemo(() => {
    const list = posts.filter((p) => inFilter(p, filter));
    return [...list].sort((a, b) => (sort === "money" ? b.moneyScore - a.moneyScore : b.createdAt.localeCompare(a.createdAt)));
  }, [posts, filter, sort]);

  async function generate(postNow = false) {
    setBusy(true);
    setPostingNow(postNow);
    try {
      const created = await api<Post[]>("/api/generate", {
        body: kind === "video"
          ? { kind, platform, count, topic, niche: genre ? "auto" : vNiche, style: vStyle, length: vLen, mediaIds: attach.length ? attach : undefined, genre: genre || undefined, sourceText: fromText ? sourceText : undefined, faceless, renderNow: fromText && renderNow }
          : { kind, platform, pillar, format, count, topic, imageUrl: imageUrl || undefined, mediaIds: attach.length ? attach : undefined, mature: platform === "x" && mature, genre: genre || undefined, sourceText: fromText ? sourceText : undefined },
      });
      setPosts((p) => [...created, ...p]);
      setFilter("all");
      if (postNow && kind !== "video") {
        await publishNow(created);
        refresh();
        return;
      }
      toast(kind === "video" ? `${created.length} video plan${created.length > 1 ? "s" : ""} ready` : `${created.length} draft${created.length > 1 ? "s" : ""} ready`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setPostingNow(false);
    }
  }

  /** Publish freshly generated drafts straight away, through the same checks as the Post now button. */
  async function publishNow(created: Post[]) {
    let published = 0;
    const notes: string[] = [];
    for (const p of created) {
      try {
        const r = await api<{ outcome: string; message: string; post: Post; handoff?: boolean }>("/api/posts/publish", { body: { id: p.id } });
        if (r.post) setPosts((list) => list.map((x) => (x.id === p.id ? r.post : x)));
        // Facebook profile: open the one-tap posting screen for the first post.
        if (r.handoff) return router.push(`/post/${p.id}`);
        if (r.outcome === "published") published++;
        else if (r.message) notes.push(r.message);
      } catch (e) {
        notes.push((e as Error).message);
      }
    }
    if (published === created.length) toast(`Published ${published} post${published > 1 ? "s" : ""}`, "success");
    else toast(`${published} of ${created.length} published. ${notes[0] ?? ""} The rest are saved as drafts below.`, published ? "info" : "error");
  }

  const onChange = (id: string) => (p: Post | null) => {
    setPosts((list) => (p ? list.map((x) => (x.id === id ? p : x)) : list.filter((x) => x.id !== id)));
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Content Studio"
        subtitle="Generate on-voice posts, score their money potential, and push them to the calendar."
        actions={
          <div className="flex flex-wrap gap-2">
            <StarterButton onDone={load} variant="primary" />
            <Button size="sm" onClick={() => setImportOpen(true)}><FileUp className="h-3.5 w-3.5" /> Import CSV</Button>
            {(["csv", "md", "json"] as const).map((f) => (
              <a key={f} href={`/api/export?type=posts&format=${f}`}>
                <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /> {f.toUpperCase()}</Button>
              </a>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Card className="h-fit xl:sticky xl:top-10">
          <CardHeader
            title="Generate"
            subtitle={!kind ? "First, what are you making?" : kind === "video" ? (fromText ? "Text to video — a faceless video built from your text." : "Video post — a complete, production-ready video plan.") : "Text post — on-voice posts with their money potential."}
            icon={<WandSparkles className="h-4 w-4" />}
            action={kind ? <Button size="sm" variant="ghost" onClick={() => setKind(null)}>Change</Button> : undefined}
          />
          {!kind ? (
            <div className="grid gap-3 p-5">
              <KindButton icon={<PenLine className="h-5 w-5" />} title="Text post" text="Posts, threads, carousels and captions, ready to publish." onClick={() => { setKind("text"); setFromText(false); if (count > 5) setCount(1); }} />
              <KindButton icon={<Clapperboard className="h-5 w-5" />} title="Video post" text="Full script, scene-by-scene visuals, on-screen text, voice and music direction, titles, thumbnail and caption. Up to 10 minutes." onClick={() => { setKind("video"); setFromText(false); if (count > 3) setCount(1); }} />
              <KindButton icon={<FileText className="h-5 w-5" />} title="Text to video" text="Paste an article, notes or a script. Get a faceless video built only from it, and render it to MP4 in one go." onClick={() => { setKind("video"); setFromText(true); setRenderNow(true); setCount(1); }} />
            </div>
          ) : (
          <div className="grid gap-4 p-5">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-white/80">Platform</span>
              <div className="grid grid-cols-6 gap-1.5">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPlatform(p)}
                    className={cn(
                      "focus-ring rounded-xl py-2.5 text-xs font-semibold ring-1 transition-all",
                      platform === p ? "bg-mint-400/15 text-mint-200 ring-mint-400/40 shadow-glow" : "bg-white/[0.03] text-white/55 ring-white/10 hover:text-white",
                    )}
                    title={PLATFORM_SPECS[p].name}
                  >
                    {PLATFORM_SPECS[p].short}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-white/40">{kind === "video" ? VIDEO_TARGET[platform] : PLATFORM_SPECS[platform].publish}</p>
            </div>
            <Field label="Genre" hint={<Link href="/trends" className="text-mint-300 hover:underline">Live stories →</Link>}>
              <Select value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="">{kind === "video" ? "Pick by niche (below)" : "My usual voice and pillars"}</option>
                {GENRES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
            {kind === "video" ? (
              <>
                {!genre && (
                <Field label="Niche">
                  <Select value={vNiche} onChange={(e) => setVNiche(e.target.value)}>
                    {NICHES.filter((n) => n.id !== "kids").map((n) => <option key={n.id} value={n.id}>{n.name} · ${n.rpm.toFixed(2)} RPM</option>)}
                  </Select>
                </Field>
                )}
                <div className="grid grid-cols-[1fr_90px] gap-3">
                  <Field label="Style">
                    <Select value={vStyle} onChange={(e) => setVStyle(e.target.value as VideoPlan["style"])}>
                      {Object.entries(VIDEO_STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="How many">
                    <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
                  </Field>
                </div>
                <Field label="Length">
                  <Select value={vLen} onChange={(e) => setVLen(e.target.value as VideoPlan["length"])}>
                    {Object.entries(VIDEO_LENGTHS).filter(([k]) => lengthAllowed(k as VideoPlan["length"], platform)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </Select>
                </Field>
                <div className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                  <div>
                    <p className="text-[13px] font-medium text-white">Faceless</p>
                    <p className="text-xs text-white/50">Voiceover over stock footage, maps, documents and AI scenes. Nobody on camera.</p>
                  </div>
                  <Switch checked={faceless} onChange={setFaceless} label="Faceless video" />
                </div>
              </>
            ) : (
            <>
            <Field label="Content pillar">
              <Select value={pillar} onChange={(e) => setPillar(e.target.value as Pillar | "auto")}>
                <option value="auto">Auto — weighted by your money mix</option>
                {PILLARS.map((p) => (
                  <option key={p} value={p}>{PILLAR_LABEL[p]}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-[1fr_90px] gap-3">
              <Field label="Format">
                <Select value={format} onChange={(e) => setFormat(e.target.value as Format | "auto")}>
                  <option value="auto">Best fit</option>
                  {formats.map((f) => (
                    <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Count">
                <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </Field>
            </div>
            </>
            )}
            {fromText ? (
              <>
                <Field label="Your text" hint={`${sourceText.length.toLocaleString()} / 15,000`}>
                  <Textarea value={sourceText} onChange={(e) => setSourceText(e.target.value.slice(0, 15000))} placeholder="Paste an article, your notes, a transcript or a finished script. The video uses only what's in here." className="min-h-[180px]" />
                </Field>
                {kind === "video" && (
                  <div className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                    <div>
                      <p className="text-[13px] font-medium text-white">Render the video right away</p>
                      <p className="text-xs text-white/50">Voice, visuals and captions into an MP4 · {videoCredits(vLen, "render")} more credits.</p>
                    </div>
                    <Switch checked={renderNow} onChange={setRenderNow} label="Render now" />
                  </div>
                )}
              </>
            ) : (
              <button className="focus-ring -mt-1 w-fit text-left text-xs text-white/45 hover:text-white" onClick={() => setFromText(true)}>+ Build it from my own text instead</button>
            )}
            {!fromText && (
            <Field label={kind === "video" ? "Topic or story" : "Topic or angle"} hint={kind === "video" ? "optional — blank picks the strongest documented story" : "optional"}>
              <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={kind === "video" ? "e.g. The Great Emu War of 1932" : "e.g. Why most people's 'side hustle' is a second job with worse pay"} className="min-h-[80px]" />
            </Field>
            )}
            {media.length > 0 && (
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-white/80">Attach media <span className="font-normal text-white/40">· {platform === "instagram" ? "first image is used for the post" : "optional"}</span></span>
                <div className="flex flex-wrap gap-2">
                  {media.slice(0, 15).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setAttach((a) => (a.includes(m.id) ? a.filter((x) => x !== m.id) : [...a, m.id].slice(0, 10)))}
                      className={cn("focus-ring h-12 w-12 overflow-hidden rounded-lg ring-2", attach.includes(m.id) ? "ring-mint-400" : "ring-transparent opacity-60 hover:opacity-100")}
                      title={m.name}
                    >
                      {m.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-ink-900 text-[10px] text-white/60">video</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {kind === "text" && platform === "instagram" && !attach.length && (
              <Field label="Or an image URL" hint="Instagram needs an image">
                <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/image.jpg" />
              </Field>
            )}
            {kind === "text" && platform === "x" && settings?.matureX && (
              <div className="flex items-start justify-between gap-3 rounded-xl bg-red-500/[0.05] p-3 ring-1 ring-red-400/20">
                <div>
                  <p className="text-[13px] font-medium text-white">Mature (18+)</p>
                  <p className="text-xs text-white/50">Frank, adult-perspective posts. Never explicit. Always published by hand.</p>
                </div>
                <Switch checked={mature} onChange={setMature} label="Mature post" tone="red" />
              </div>
            )}
            <Button variant="primary" size="lg" loading={busy && !postingNow} onClick={() => generate(false)} disabled={busy || !settings || (fromText && sourceText.trim().length < 40)}>
              <Sparkles className="h-4 w-4" />{" "}
              {kind === "video"
                ? busy && !postingNow ? "Producing…" : `Generate video plan · ${videoCost} credit${videoCost > 1 ? "s" : ""}`
                : busy && !postingNow ? "Writing…" : `Generate · ${count * CREDIT_COST.post} credit${count > 1 ? "s" : ""}`}
            </Button>
            {kind === "text" && (
              <>
                <Button variant="gold" size="lg" loading={busy && postingNow} onClick={() => generate(true)} disabled={busy || !settings || (platform === "x" && mature) || (fromText && sourceText.trim().length < 40)}>
                  <Send className="h-4 w-4" /> {busy && postingNow ? "Writing and posting…" : "Generate & post now"}
                </Button>
                <p className="-mt-2 text-[11px] text-white/40">
                  {platform === "x" && mature
                    ? "Mature posts are always reviewed and posted by hand."
                    : "Publishes to your connected account the moment it's written. The kill switch, safety filter and rate limits still apply."}
                </p>
              </>
            )}
          </div>
          )}
        </Card>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => {
              const n = posts.filter((p) => inFilter(p, f.key)).length;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "focus-ring rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    filter === f.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white",
                  )}
                >
                  {f.label} <span className="text-white/35">{n}</span>
                </button>
              );
            })}
            <div className="ml-auto">
              <Select value={sort} onChange={(e) => setSort(e.target.value as "new" | "money")} className="w-40">
                <option value="new">Newest first</option>
                <option value="money">Highest money score</option>
              </Select>
            </div>
          </div>
          {busy && <div className="glass mb-4 h-28 animate-pulse" />}
          <div className="grid gap-4">
            {settings && shown.map((p) => <PostCard key={p.id} post={p} settings={settings} onChange={onChange(p.id)} compact={shown.length > 3} />)}
          </div>
          {!shown.length && !busy && (
            <Card>
              <Empty
                icon={<Sparkles className="h-6 w-6" />}
                title="No posts here yet"
                body="Pick a platform and hit Generate, or add ready-made posts: hand-written true stories plus two finished video plans you can render. They use no credits. Drafts stay private until you schedule or post them."
                action={<StarterButton onDone={load} variant="primary" size="md" />}
              />
            </Card>
          )}
        </div>
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); refresh(); }} />}
    </>
  );
}

const CSV_TEMPLATE = `platform,date,time,text,hashtags
x,2026-11-02,08:30,"Your savings rate beats your returns for the first decade.\nSave this for your next raise.",
linkedin,2026-11-02,12:00,"The most expensive decision is the one you keep postponing.",careers decisions
facebook,,,"Draft with no date stays in Drafts until you schedule it.",
`;

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { status, toast } = useApp();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const allowed = status?.me.plan.features.bulkImport ?? false;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-2xl p-6" role="dialog" aria-modal="true" aria-label="Import CSV" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white">Import posts from CSV</h3>
        <p className="mt-1 text-sm text-white/55">Columns: <code>platform</code>, <code>text</code>, and optional <code>date</code> (YYYY-MM-DD), <code>time</code> (HH:MM, your timezone), <code>hashtags</code>. Rows with a date and time are scheduled; the rest become drafts. Importing uses no credits.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="cursor-pointer">
            <span className="inline-flex h-8 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/90 hover:bg-white/[0.08]">Choose a .csv file</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          </label>
          <Button size="sm" variant="ghost" onClick={() => setCsv(CSV_TEMPLATE)}>Use the example</Button>
        </div>
        <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Or paste CSV here" className="mt-3 min-h-[180px] font-mono text-xs" />
        {errors.length > 0 && <ul className="mt-3 max-h-32 overflow-auto rounded-lg bg-red-500/10 p-3 text-xs text-red-200 ring-1 ring-red-400/25">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="mt-4 flex gap-2">
          {allowed ? (
            <Button
              variant="primary"
              loading={busy}
              disabled={!csv.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api<{ imported: number; scheduled: number; errors: string[] }>("/api/import", { body: { csv } });
                  setErrors(r.errors);
                  toast(`${r.imported} imported · ${r.scheduled} scheduled${r.errors.length ? ` · ${r.errors.length} rows skipped` : ""}`, r.imported ? "success" : "error");
                  if (r.imported && !r.errors.length) onDone();
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FileUp className="h-4 w-4" /> Import
            </Button>
          ) : (
            <Link href="/plans"><Button variant="gold">Bulk import is included from Creator</Button></Link>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function KindButton({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="focus-ring grid grid-cols-[40px_1fr] gap-x-3 rounded-2xl bg-white/[0.02] p-4 text-left ring-1 ring-white/10 transition-all hover:bg-mint-400/[0.06] hover:ring-mint-400/40">
      <span className="row-span-2 grid h-10 w-10 place-items-center rounded-xl bg-mint-400/10 text-mint-300 ring-1 ring-mint-400/25">{icon}</span>
      <span className="text-[15px] font-semibold text-white">{title}</span>
      <span className="text-xs leading-relaxed text-white/55">{text}</span>
    </button>
  );
}
