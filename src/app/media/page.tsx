"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Images, Play, Trash2, Upload, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard } from "@/lib/client";
import type { MediaItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Empty, PageHeader } from "@/components/ui";

type Item = MediaItem & { url: string };
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

export default function MediaPage() {
  const toast = useApp((s) => s.toast);
  const [items, setItems] = useState<Item[]>([]);
  const [used, setUsed] = useState(0);
  const [limit, setLimit] = useState(1);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [playing, setPlaying] = useState<Item | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[]; usedBytes: number; limitBytes: number }>("/api/media");
      setItems(r.items);
      setUsed(r.usedBytes);
      setLimit(r.limitBytes);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const fd = new FormData();
    Array.from(files).slice(0, 20).forEach((f) => fd.append("files", f));
    try {
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const data = (await res.json()) as { saved?: Item[]; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      data.errors?.forEach((e) => toast(e, "error"));
      if (data.saved?.length) toast(`${data.saved.length} file${data.saved.length > 1 ? "s" : ""} uploaded`, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Media Library" subtitle="Upload images and videos to attach to posts. Instagram posts use the first attached image." />
      <Card className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-white/70">Storage</span>
          <span className="tabular-nums text-white">{mb(used)} of {mb(limit)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-gold-400" style={{ width: `${Math.max(1, Math.min(100, (used / limit) * 100))}%` }} /></div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={cn("mt-5 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors", drag ? "border-mint-400 bg-mint-400/[0.05]" : "border-white/10 hover:border-white/25")}
        >
          <Upload className="h-6 w-6 text-mint-300" />
          <span className="font-medium text-white">{busy ? "Uploading…" : "Drop files here or tap to upload"}</span>
          <span className="text-xs text-white/45">JPG, PNG, WebP, GIF, MP4, MOV, MP3, WAV, M4A · up to 2 GB each · 20 at a time</span>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a" className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
        <p className="mt-3 text-xs text-white/40">Only upload content you own or have rights to, and that follows each platform's rules. Explicit or nude media is never published automatically.</p>
      </Card>

      {items.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((m) => (
            <div key={m.id} className="glass overflow-hidden">
              <div className="aspect-square bg-ink-950">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                ) : m.kind === "audio" ? (
                  <div className="grid h-full w-full place-items-center bg-gradient-to-br from-violet-500/20 to-mint-400/10 p-3">
                    <audio src={m.url} controls preload="none" className="w-full" />
                  </div>
                ) : (
                  <button className="focus-ring group relative block h-full w-full" onClick={() => setPlaying(m)} aria-label={`Play ${m.name}`}>
                    {/* #t=0.1 makes iPhones show the first frame as the thumbnail. */}
                    <video src={`${m.url}#t=0.1`} className="pointer-events-none h-full w-full object-cover" muted playsInline preload="metadata" />
                    <span className="absolute inset-0 grid place-items-center bg-black/25 transition group-hover:bg-black/40">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-ink-950 shadow-lg"><Play className="ml-0.5 h-5 w-5 fill-current" /></span>
                    </span>
                  </button>
                )}
              </div>
              <div className="grid gap-2 p-3">
                <p className="truncate text-sm text-white" title={m.name}>{m.name}</p>
                <div className="flex items-center gap-2">
                  <Badge tone={m.kind === "image" ? "violet" : m.kind === "audio" ? "gold" : "sky"}>{m.kind}</Badge>
                  <span className="text-xs tabular-nums text-white/40">{mb(m.size)}</span>
                  <button className="ml-auto text-white/40 hover:text-white" title="Copy media ID" onClick={async () => toast((await copyToClipboard(m.id)) ? "Media ID copied" : "Copy blocked", "success")}>
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className={cn("text-xs", confirm === m.id ? "text-red-300" : "text-white/40 hover:text-red-300")}
                    title="Delete"
                    onClick={async () => {
                      if (confirm !== m.id) {
                        setConfirm(m.id);
                        setTimeout(() => setConfirm(null), 3500);
                        return;
                      }
                      await api(`/api/media?id=${m.id}`, { method: "DELETE" });
                      setItems((x) => x.filter((y) => y.id !== m.id));
                      setUsed((u) => u - m.size);
                    }}
                  >
                    {confirm === m.id ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card><Empty icon={<Images className="h-6 w-6" />} title="No uploads yet" body="Upload images and clips here, then attach them to posts in Content Studio." /></Card>
      )}
      {playing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label={playing.name} onClick={() => setPlaying(null)}>
          <div className="grid w-full max-w-3xl gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <p className="truncate text-sm text-white">{playing.name}</p>
              <a href={`${playing.url}&dl=${encodeURIComponent(playing.name.replace(/[^A-Za-z0-9._-]/g, "_"))}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-white/80 ring-1 ring-white/15 hover:text-white">
                <Download className="h-3.5 w-3.5" /> Download
              </a>
              <button className="focus-ring rounded-lg p-1.5 text-white/70 hover:text-white" onClick={() => setPlaying(null)} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <video key={playing.id} src={playing.url} controls autoPlay playsInline className="max-h-[80vh] w-full rounded-lg bg-black" />
          </div>
        </div>
      )}
    </>
  );
}
