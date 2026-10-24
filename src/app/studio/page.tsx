"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioLines, Clapperboard, Download, FileText, FileUp, PenLine, Send, Sparkles, Upload, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { Format, MediaItem, Pillar, Placement, Platform, Post, PostStatus } from "@/lib/types";
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
  // Audio to video: an uploaded recording becomes the soundtrack and the pictures follow it.
  const [fromAudio, setFromAudio] = useState(false);
  const [audioId, setAudioId] = useState("");
  const [about, setAbout] = useState("");
  const [landscape, setLandscape] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [faceless, setFaceless] = useState(true);
  const [renderNow, setRenderNow] = useState(false);
  const [voiceover, setVoiceover] = useState(true);
  const [motion, setMotion] = useState(false);
  const [autoPost, setAutoPost] = useState(false);
  const [placement, setPlacement] = useState<Placement>("auto");
  const [account, setAccount] = useState("");
  const conn = status?.credentials.find((c) => c.platform === platform);
  useEffect(() => setAccount(""), [platform]);
  useEffect(() => {
    if (settings) setFaceless(settings.faceless ?? true);
  }, [settings?.faceless]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (settings) setAutoPost(settings.autoPost?.enabled ?? false);
  }, [settings?.autoPost?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasPlacement = platform === "instagram" || platform === "facebook";
  useEffect(() => {
    if (settings && (platform === "instagram" || platform === "facebook")) setPlacement(settings.autoPost?.[platform] ?? "auto");
  }, [platform, settings?.autoPost]); // eslint-disable-line react-hooks/exhaustive-deps
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

  async function uploadAudio(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const r = (await res.json()) as { saved?: (MediaItem & { url: string })[]; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(r.error ?? `Upload failed (${res.status})`);
      if (r.errors?.length) toast(r.errors[0], "error");
      const item = r.saved?.[0];
      if (item) {
        setMedia((m) => [item, ...m]);
        setAudioId(item.id);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function audioToVideo() {
    setBusy(true);
    try {
      const created = await api<Post>("/api/audio-video", {
        body: { mediaId: audioId, platform, landscape: landscape && (platform === "youtube" || platform === "facebook"), visuals: motion ? "motion" : "auto", about: about || undefined, renderNow, autoPost, placement: hasPlacement ? placement : undefined, account: account || undefined },
      });
      setPosts((p) => [created, ...p]);
      setFilter("all");
      toast(created.render?.status === "queued" ? (autoPost ? "Video rendering — it posts itself when ready" : "Video rendering — it appears below when ready") : "Video plan ready — press Render video on it", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (fromAudio) return audioToVideo();
    const posting = autoPost && !(kind === "text" && platform === "x" && mature);
    setBusy(true);
    setPostingNow(posting);
    try {
      const shared = { autoPost: posting, placement: hasPlacement ? placement : undefined, account: account || undefined };
      const created = await api<Post[]>("/api/generate", {
        body: kind === "video"
          ? { kind, platform, count, topic, niche: genre ? "auto" : vNiche, style: vStyle, length: vLen, mediaIds: attach.length ? attach : undefined, genre: genre || undefined, sourceText: fromText ? sourceText : undefined, faceless, renderNow: fromText && renderNow, voiceover, visuals: motion ? "motion" : "auto", ...shared }
          : { kind, platform, pillar, format, count, topic, imageUrl: imageUrl || undefined, mediaIds: attach.length ? attach : undefined, mature: platform === "x" && mature, genre: genre || undefined, sourceText: fromText ? sourceText : undefined, ...shared },
      });
      setPosts((p) => [...created, ...p]);
      setFilter("all");
      if (posting && kind !== "video") {
        reportPosting(created);
        refresh();
        return;
      }
      toast(
        kind === "video"
          ? posting
            ? `${created.length} video${created.length > 1 ? "s" : ""} rendering — ${created.length > 1 ? "each posts itself" : "it posts itself"} when ready`
            : `${created.length} video plan${created.length > 1 ? "s" : ""} ready`
          : `${created.length} draft${created.length > 1 ? "s" : ""} ready`,
        "success",
      );
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setPostingNow(false);
    }
  }

  /** The server posted them as they were written (same checks as Post now); say how it went. */
  function reportPosting(created: Post[]) {
    // Facebook profile: open the one-tap posting screen.
    const handoff = created.find((p) => p.handoff && p.status === "copy_ready");
    if (handoff) return router.push(`/post/${handoff.id}`);
    const published = created.filter((p) => p.status === "published").length;
    const queued = created.filter((p) => p.status === "scheduled" || p.status === "pending_review").length;
    const note = created.find((p) => p.status !== "published" && p.error)?.error;
    if (published === created.length) toast(`Published ${published} post${published > 1 ? "s" : ""}`, "success");
    else toast(`${published} of ${created.length} published${queued ? `, ${queued} queued to post shortly` : ""}. ${note ?? ""}`, published || queued ? "info" : "error");
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
            subtitle={!kind ? "First, what are you making?" : kind === "video" ? (fromAudio ? "Audio to video — your recording, with pictures that follow what's said." : fromText ? "Text to video — a faceless video built from your text." : "Video post — a complete, production-ready video plan.") : "Text post — on-voice posts with their money potential."}
            icon={<WandSparkles className="h-4 w-4" />}
            action={kind ? <Button size="sm" variant="ghost" onClick={() => setKind(null)}>Change</Button> : undefined}
          />
          {!kind ? (
            <div className="grid gap-3 p-5">
              <KindButton icon={<PenLine className="h-5 w-5" />} title="Text post" text="Posts, threads, carousels and captions, ready to publish." onClick={() => { setKind("text"); setFromText(false); setFromAudio(false); if (count > 5) setCount(1); }} />
              <KindButton icon={<Clapperboard className="h-5 w-5" />} title="Video post" text="Full script, scene-by-scene visuals, on-screen text, voice and music direction, titles, thumbnail and caption. Up to 10 minutes." onClick={() => { setKind("video"); setFromText(false); setFromAudio(false); if (count > 3) setCount(1); }} />
              <KindButton icon={<FileText className="h-5 w-5" />} title="Text to video" text="Paste an article, notes or a script. Get a faceless video built only from it, and render it to MP4 in one go." onClick={() => { setKind("video"); setFromText(true); setFromAudio(false); setRenderNow(true); setCount(1); }} />
              <KindButton icon={<AudioLines className="h-5 w-5" />} title="Audio to video" text="Upload a podcast, voice note, sermon or song. Get a video whose pictures and captions follow what's said, with your recording as the sound. Up to 10 minutes." onClick={() => { setKind("video"); setFromAudio(true); setFromText(false); setRenderNow(true); setCount(1); }} />
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
            {fromAudio ? (
              <AudioPanel
                media={media}
                audioId={audioId}
                setAudioId={setAudioId}
                uploading={uploading}
                onUpload={uploadAudio}
                about={about}
                setAbout={setAbout}
                platform={platform}
                landscape={landscape}
                setLandscape={setLandscape}
                motion={motion}
                setMotion={setMotion}
                renderNow={renderNow}
                setRenderNow={setRenderNow}
              />
            ) : (
            <>
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
                <div className="grid gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-white">Voiceover</p>
                      <p className="text-xs text-white/50">A narrator reads the script. Off: captions and music only.</p>
                    </div>
                    <Switch checked={voiceover} onChange={setVoiceover} label="Voiceover" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-white">Motion graphics</p>
                      <p className="text-xs text-white/50">Animated shapes and kinetic words in every scene, instead of stock footage. Free.</p>
                    </div>
                    <Switch checked={motion} onChange={setMotion} label="Motion graphics" />
                  </div>
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
            </>
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
            <div className="grid gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-white">Post automatically</p>
                  <p className="text-xs text-white/50">
                    {fromAudio
                      ? "Renders the video (render credits by length), then posts it to your connected account."
                      : kind === "video"
                      ? `Renders each video (${videoCredits(vLen, "render")} more credits), then posts it to your connected account.`
                      : platform === "x" && mature
                        ? "Mature posts are always reviewed and posted by hand."
                        : "Posts to your connected account the moment it's written."}{" "}
                    The kill switch, safety filter and rate limits still apply.
                  </p>
                </div>
                <Switch checked={autoPost} onChange={setAutoPost} label="Post automatically" />
              </div>
              {!!conn?.accounts?.length && (
                <Field label="Account" hint="Which account posts it">
                  <Select value={account} onChange={(e) => setAccount(e.target.value)}>
                    <option value="">{conn.handle || "Main account"}</option>
                    {conn.accounts.map((a) => <option key={a.id} value={a.id}>{a.handle || "Another account"}</option>)}
                  </Select>
                </Field>
              )}
              {hasPlacement && (
                <Field label="Post as" hint={platform === "facebook" ? "Auto: Reels up to 90 s, longer videos to the feed" : "Auto: videos as Reels, pictures as posts or carousels"}>
                  <Select value={placement} onChange={(e) => setPlacement(e.target.value as Placement)}>
                    <option value="auto">Auto (best fit)</option>
                    <option value="reel">Reel</option>
                    <option value="feed">Feed post{platform === "instagram" ? " / carousel" : ""}</option>
                    <option value="story">Story (up to 60 s)</option>
                  </Select>
                </Field>
              )}
            </div>
            <Button variant={autoPost ? "gold" : "primary"} size="lg" loading={busy} onClick={generate} disabled={busy || !settings || (fromText && sourceText.trim().length < 40) || (fromAudio && !audioId)}>
              {autoPost ? <Send className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{" "}
              {fromAudio
                ? busy ? "Listening and planning…" : autoPost ? "Make the video & post" : renderNow ? "Make the video" : "Plan the video"
                : kind === "video"
                ? busy ? "Producing…" : `${autoPost ? "Generate, render & post" : "Generate video plan"} · ${videoCost + (autoPost ? count * videoCredits(vLen, "render") : 0)} credits`
                : busy ? (postingNow ? "Writing and posting…" : "Writing…") : `${autoPost && !(platform === "x" && mature) ? "Generate & post" : "Generate"} · ${count * CREDIT_COST.post} credit${count > 1 ? "s" : ""}`}
            </Button>
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

/** Audio to video: pick or upload the recording, then the few choices that matter for it. */
function AudioPanel(p: {
  media: (MediaItem & { url: string })[];
  audioId: string;
  setAudioId: (id: string) => void;
  uploading: boolean;
  onUpload: (f: File) => void;
  about: string;
  setAbout: (v: string) => void;
  platform: Platform;
  landscape: boolean;
  setLandscape: (v: boolean) => void;
  motion: boolean;
  setMotion: (v: boolean) => void;
  renderNow: boolean;
  setRenderNow: (v: boolean) => void;
}) {
  const recordings = p.media.filter((m) => m.kind === "audio");
  const wide = p.platform === "youtube" || p.platform === "facebook";
  return (
    <>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-white/80">Your recording <span className="font-normal text-white/40">· MP3, WAV or M4A, up to 10 minutes</span></span>
        <label className={cn("focus-ring flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-3 text-sm text-white/70 hover:text-white", p.uploading && "pointer-events-none opacity-60")}>
          <Upload className="h-4 w-4" /> {p.uploading ? "Uploading…" : "Upload a recording"}
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        {recordings.length > 0 && (
          <div className="mt-2 grid max-h-44 gap-1.5 overflow-y-auto">
            {recordings.slice(0, 20).map((m) => (
              <button
                key={m.id}
                onClick={() => p.setAudioId(m.id)}
                className={cn("focus-ring flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ring-1", p.audioId === m.id ? "bg-mint-400/10 text-mint-100 ring-mint-400/40" : "bg-white/[0.03] text-white/60 ring-white/[0.07] hover:text-white")}
              >
                <AudioLines className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Field label="What is it?" hint="optional — helps pick the pictures">
        <Input value={p.about} onChange={(e) => p.setAbout(e.target.value.slice(0, 500))} placeholder="e.g. Sunday sermon on forgiveness · a love song · my podcast about credit" />
      </Field>
      <div className="grid gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
        {wide && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-white">16:9 landscape</p>
              <p className="text-xs text-white/50">Widescreen for {PLATFORM_SPECS[p.platform].name}. Off: vertical 9:16.</p>
            </div>
            <Switch checked={p.landscape} onChange={p.setLandscape} label="16:9 landscape" />
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-white">Motion graphics</p>
            <p className="text-xs text-white/50">Animated shapes and kinetic words instead of stock footage. Free.</p>
          </div>
          <Switch checked={p.motion} onChange={p.setMotion} label="Motion graphics" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-white">Render the video right away</p>
            <p className="text-xs text-white/50">Pictures, captions and your recording into an MP4.</p>
          </div>
          <Switch checked={p.renderNow} onChange={p.setRenderNow} label="Render now" />
        </div>
      </div>
      <p className="-mt-1 text-[11px] leading-snug text-white/40">
        Transcribing is free. Planning the pictures costs the same as a video plan of that length ({CREDIT_COST.videoShort}–{CREDIT_COST.videoLong} credits), and rendering {CREDIT_COST.renderShort}–{CREDIT_COST.renderLong} more.
      </p>
    </>
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
