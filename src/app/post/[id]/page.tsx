"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, Copy, Download, ExternalLink, Info, Share, Sparkles } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard, fmtDateTime } from "@/lib/client";
import type { Post } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Field, Input, PlatformChip, Spinner } from "@/components/ui";

type Media = { kind: "video" | "image"; url: string; downloadUrl: string; name: string; type: string; size: number };
type Data = {
  post: Post;
  caption: string;
  media: Media | null;
  profile: { connected: boolean; name: string | null; url: string | null };
  waiting: { id: string; hook: string; kind: string }[];
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;

/** Loads the signed file into memory with progress, so the share sheet can open instantly on tap. */
async function loadFile(m: Media, signal: AbortSignal, onProgress: (p: number) => void): Promise<File> {
  const res = await fetch(m.url, { signal });
  if (!res.ok) throw new Error(`The file couldn't be loaded (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || m.size;
  const reader = res.body?.getReader();
  if (!reader) return new File([await res.blob()], m.name, { type: m.type });
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(Math.min(1, got / total));
  }
  return new File(chunks as BlobPart[], m.name, { type: m.type });
}

function canShareFile(file: File | null) {
  try {
    return !!file && typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * "Post to your Facebook profile": Facebook doesn't let apps post to personal profiles (monetized ones included),
 * so Nexus Pulse prepares the post and the person makes the final tap: share the HD video to Facebook, paste the
 * caption (already copied), then mark it posted.
 */
export default function PostToProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status, toast, refresh } = useApp();
  const tz = status?.settings.timezone ?? "America/Chicago";
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"ready" | "posted" | null>(null);
  const shareable = canShareFile(file);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Data>(`/api/posts/handoff?id=${encodeURIComponent(id)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    setFile(null);
    setProgress(0);
    setCopied(false);
    setShared(false);
    setLink("");
    load();
  }, [load]);

  // Get the HD file ready in the background (phones need it in hand before the share sheet can open).
  useEffect(() => {
    const m = data?.media;
    if (!m || data?.post.status !== "copy_ready") return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoadError(null);
    loadFile(m, ctrl.signal, setProgress)
      .then((f) => !ctrl.signal.aborted && setFile(f))
      .catch((e: Error) => !ctrl.signal.aborted && setLoadError(e.message));
    return () => ctrl.abort();
  }, [data?.media, data?.post.status]);

  if (error) {
    return (
      <Card className="mx-auto max-w-lg p-6 text-center">
        <p className="text-sm text-red-300">{error}</p>
        <Link href="/studio" className="mt-4 inline-block"><Button>Back to Studio</Button></Link>
      </Card>
    );
  }
  if (!data) return <div className="glass mx-auto h-[70vh] max-w-5xl animate-pulse" />;

  const { post, caption, media, profile, waiting } = data;
  const ready = post.status === "copy_ready";
  const posted = post.status === "published";
  const fbHome = profile.url ?? "https://www.facebook.com/";
  const next = waiting[0];

  async function copyCaption() {
    const ok = await copyToClipboard(caption);
    setCopied(ok);
    toast(ok ? "Caption copied — paste it in Facebook" : "Copy was blocked. Press and hold the caption to copy it.", ok ? "success" : "error");
  }

  /** One tap: copy the caption, then open the share sheet with the HD file (both start inside the same tap). */
  function shareToFacebook() {
    void copyToClipboard(caption).then(setCopied);
    if (file && shareable) {
      navigator
        .share({ files: [file] })
        .then(() => setShared(true))
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          toast("Your phone blocked the share sheet. Tap Share to Facebook again — the caption is already copied.", "info");
        });
      return;
    }
    window.open(fbHome, "_blank", "noopener,noreferrer");
    setShared(true);
  }

  async function getReady() {
    setBusy("ready");
    try {
      const r = await api<{ outcome: string; message: string }>("/api/posts/publish", { body: { id: post.id } });
      if (r.outcome !== "copy_ready" && r.outcome !== "published") toast(r.message, "info");
      await load();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function markPosted() {
    setBusy("posted");
    try {
      const p = await api<Post>("/api/posts/handoff", { body: { id: post.id, link } });
      setData({ ...data!, post: p });
      toast("Marked as posted", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const preparing = !!media && ready && !file && !loadError;
  const stepDone = [shared, copied || shared, posted];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <button onClick={() => router.back()} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-white/55 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {waiting.length > 0 && (
          <Badge tone="gold">{waiting.length} more ready</Badge>
        )}
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <PlatformChip platform="facebook" />
          <span className="text-xs uppercase tracking-[0.18em] text-white/45">Your profile{profile.name ? ` · ${profile.name}` : ""}</span>
        </div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white sm:text-[28px]">
          {posted ? "Posted on your profile" : ready ? "Ready to post on Facebook" : "Post to your Facebook profile"}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/55">{post.hook}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Media */}
        <Card className="self-start overflow-hidden p-0">
          {media?.kind === "video" ? (
            // #t=0.1 makes iPhones show the first frame instead of a black box.
            <video src={`${media.url}#t=0.1`} controls playsInline preload="metadata" className="mx-auto block max-h-[62vh] w-full bg-black object-contain" />
          ) : media?.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt="" className="mx-auto block max-h-[62vh] w-full bg-black object-contain" />
          ) : (
            <div className="grid min-h-[220px] place-items-center bg-gradient-to-br from-blue-500/10 via-transparent to-mint-400/10 p-6">
              <p className="max-w-xs text-center text-[15px] font-medium leading-relaxed text-white/85">“{post.hook}”</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3 text-xs text-white/50">
            {media ? <span>{media.kind === "video" ? "HD video" : "Image"} · {mb(media.size)}</span> : <span>Text post</span>}
            {post.handoff?.readyAt && <span>· ready {fmtDateTime(post.handoff.readyAt, tz)}</span>}
            {media && (
              <a href={media.downloadUrl} className="ml-auto inline-flex items-center gap-1 text-mint-300 hover:underline">
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            )}
          </div>
        </Card>

        {/* Steps */}
        <div className="grid content-start gap-4">
          {posted ? (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-mint-300" />
                <div className="min-w-0">
                  <p className="font-medium text-white">Done. It's recorded as posted{post.publishedAt ? ` on ${fmtDateTime(post.publishedAt, tz)}` : ""}.</p>
                  {post.externalUrl && (
                    <a href={post.externalUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-mint-300 hover:underline">
                      View on Facebook <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
              {next ? (
                <Link href={`/post/${next.id}`} className="mt-4 block">
                  <Button variant="primary" size="lg" className="w-full">Next ready post <ArrowRight className="h-4 w-4" /></Button>
                </Link>
              ) : (
                <Link href="/calendar" className="mt-4 block"><Button className="w-full">Back to the calendar</Button></Link>
              )}
            </Card>
          ) : !ready ? (
            <Card className="p-5">
              <p className="text-sm leading-relaxed text-white/75">
                {post.scheduledAt && post.status === "scheduled"
                  ? `This post is scheduled for ${fmtDateTime(post.scheduledAt, tz)}. It will be ready for you then${status?.settings.handoffEmail ? ", and you'll get an email" : ""}.`
                  : "This post isn't ready yet."}
              </p>
              {profile.connected ? (
                <Button variant="primary" size="lg" className="mt-4 w-full" loading={busy === "ready"} onClick={getReady}>
                  <Sparkles className="h-4 w-4" /> Get it ready now
                </Button>
              ) : (
                <p className="mt-3 text-xs text-white/50">Facebook is connected as a Page, so this post publishes automatically at its time.</p>
              )}
            </Card>
          ) : (
            <>
              <Step n={1} done={stepDone[0]} title={media && shareable ? "Share it to Facebook" : media ? "Save the video, then open Facebook" : "Open Facebook"}>
                {preparing && (
                  <div className="mb-3">
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-white/55">
                      <Spinner className="h-3.5 w-3.5" /> Getting the HD {media?.kind === "image" ? "image" : "video"} ready… {Math.round(progress * 100)}%
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-mint-300 transition-[width] duration-200" style={{ width: `${Math.max(4, progress * 100)}%` }} />
                    </div>
                  </div>
                )}
                {media && !shareable && !preparing ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <a href={media.downloadUrl} className="block">
                      <Button variant="primary" size="lg" className="w-full"><Download className="h-4 w-4" /> Save {media.kind === "video" ? "video" : "image"}</Button>
                    </a>
                    <Button size="lg" className="w-full" onClick={shareToFacebook}><ExternalLink className="h-4 w-4" /> Open Facebook</Button>
                  </div>
                ) : (
                  <Button variant="primary" size="lg" className="h-14 w-full text-base" disabled={preparing} onClick={shareToFacebook}>
                    {media ? <Share className="h-5 w-5" /> : <ExternalLink className="h-5 w-5" />} Share to Facebook
                  </Button>
                )}
                <p className="mt-2.5 text-[13px] leading-relaxed text-white/55">
                  {media && shareable
                    ? `Copies the caption and opens your share sheet. Choose Facebook, then ${media.kind === "video" ? "Reel" : "Post"}.`
                    : media
                      ? "On a computer: save the file, then create a post on your profile and add it. On your phone, open this page to share in one tap."
                      : "Copies the caption and opens Facebook. Tap “What's on your mind?” on your profile."}
                </p>
                {loadError && <p className="mt-2 text-xs text-gold-300">{loadError} Use Download instead.</p>}
              </Step>

              <Step n={2} done={stepDone[1]} title="Paste the caption">
                <div className="relative">
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/60 p-3.5 pr-12 font-sans text-[13.5px] leading-relaxed text-white/80 ring-1 ring-white/[0.06]">{caption}</pre>
                  <button onClick={copyCaption} aria-label="Copy caption" className="focus-ring absolute right-2 top-2 rounded-lg bg-white/[0.06] p-2 text-white/70 hover:bg-white/[0.12] hover:text-white">
                    {copied ? <ClipboardCheck className="h-4 w-4 text-mint-300" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-2 text-[13px] text-white/55">{copied ? "Copied. In Facebook, tap the caption box and paste." : "Tap the copy button, then paste it in Facebook."}</p>
              </Step>

              <Step n={3} done={posted} title="Mark it posted">
                <Field label="Link to your post (optional)" hint="… → Copy link">
                  <Input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" autoComplete="off" placeholder="https://www.facebook.com/…" />
                </Field>
                <Button size="lg" className="mt-3 w-full" loading={busy === "posted"} onClick={markPosted}>
                  <Check className="h-4 w-4" /> I posted it
                </Button>
              </Step>

              <div className="flex gap-2.5 rounded-xl bg-white/[0.02] p-3.5 text-[12.5px] leading-relaxed text-white/50 ring-1 ring-white/[0.05]">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
                <p>Facebook doesn't let any app post to personal profiles, including monetized profiles in professional mode, so Nexus Pulse gets everything ready and you make the final tap.</p>
              </div>
            </>
          )}

          {waiting.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-white/40">Also ready</p>
              <ul className="grid gap-1">
                {waiting.slice(0, 5).map((w) => (
                  <li key={w.id}>
                    <Link href={`/post/${w.id}`} className="focus-ring flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-white/80 hover:bg-white/[0.04] hover:text-white">
                      <span className="shrink-0 text-xs">{w.kind === "video" ? "🎬" : w.kind === "media" ? "📎" : "📝"}</span>
                      <span className="min-w-0 flex-1 truncate">{w.hook}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/35" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <Card className={cn("p-4 transition-colors sm:p-5", done && "border-mint-400/20")}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ring-1", done ? "bg-mint-400 text-ink-950 ring-mint-400" : "text-white/70 ring-white/20")}>
          {done ? <Check className="h-3.5 w-3.5" /> : n}
        </span>
        <p className="font-medium text-white">{title}</p>
      </div>
      {children}
    </Card>
  );
}
