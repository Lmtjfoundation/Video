"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, FileText, FolderPlus, Heart, Library as LibraryIcon, ListFilter, Pause, Play, Search, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LutGallery } from "@/components/lut-gallery";
import {
  FOOTAGE_CATEGORIES, fmtDuration, GENRES, INSTRUMENTS, KIND_LABEL, LENGTHS, MOODS, SFX_CATEGORIES, SORTS, TEMPOS, THEMES, type AssetKind,
} from "@/lib/library-tags";

type Item = {
  id: string; kind: AssetKind; title: string; description: string; seconds: number; bpm?: number; key?: string; vocals?: boolean; aspect?: string;
  genres: string[]; moods: string[]; themes: string[]; instruments: string[]; category?: string; peaks: number[]; model: string; downloads: number;
  createdAt: string; previewUrl: string; posterUrl?: string; mine: boolean; favorite: boolean;
};
type Data = { items: Item[]; total: number; boards: { id: string; name: string; count: number }[]; canDownload: boolean; isAdmin: boolean; engine: boolean };
type Shelf = "all" | "catalog" | "mine" | "favorites" | "board";
type Facets = { genres: string[]; moods: string[]; themes: string[]; instruments: string[]; categories: string[] };
const NO_FACETS: Facets = { genres: [], moods: [], themes: [], instruments: [], categories: [] };

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="grid grid-cols-1 place-items-center py-20"><Spinner /></div>}>
      <Library />
    </Suspense>
  );
}

function Library() {
  const { toast } = useApp();
  const params = useSearchParams();
  const [kind, setKind] = useState<AssetKind>(((["music", "sfx", "footage"] as string[]).includes(params.get("kind") ?? "") ? params.get("kind") : "music") as AssetKind);
  const [luts, setLuts] = useState(params.get("kind") === "luts");
  const [shelf, setShelf] = useState<Shelf>((params.get("shelf") as Shelf) || "all");
  const [boardId, setBoardId] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("new");
  const [facets, setFacets] = useState<Facets>(NO_FACETS);
  const [vocals, setVocals] = useState("");
  const [tempo, setTempo] = useState("");
  const [length, setLength] = useState("");
  const [similar, setSimilar] = useState<Item | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [playing, setPlaying] = useState<Item | null>(null);
  const [paused, setPaused] = useState(true);
  const [pos, setPos] = useState(0);
  const [download, setDownload] = useState<{ item: Item; url: string; fileName: string; license: string } | null>(null);
  const [boardFor, setBoardFor] = useState<Item | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const focusId = useRef(params.get("item"));

  const query = useMemo(() => {
    const p = new URLSearchParams({ kind, shelf, sort });
    if (shelf === "board" && boardId) p.set("board", boardId);
    if (q.trim()) p.set("q", q.trim());
    for (const [k, v] of Object.entries(facets)) if (v.length) p.set(k, v.join(","));
    if (vocals) p.set("vocals", vocals);
    if (tempo) p.set("tempo", tempo);
    if (length) p.set("length", length);
    if (similar) p.set("similar", similar.id);
    return p.toString();
  }, [kind, shelf, boardId, q, sort, facets, vocals, tempo, length, similar]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Data>(`/api/library?${query}`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [query, toast]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // A finished generation links here with ?item=…: start playing it once it's listed.
  useEffect(() => {
    const it = focusId.current && data?.items.find((x) => x.id === focusId.current);
    if (it) {
      focusId.current = null;
      document.getElementById(`item-${it.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (it.kind !== "footage") play(it);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  // While the player is open, the jobs tray moves up so the two don't overlap.
  useEffect(() => {
    document.body.classList.toggle("has-player", !!playing);
    return () => document.body.classList.remove("has-player");
  }, [playing]);
  useEffect(() => {
    const done = () => load();
    window.addEventListener("ghostpost:job-done", done);
    return () => window.removeEventListener("ghostpost:job-done", done);
  }, [load]);

  function switchKind(k: AssetKind) {
    setLuts(false);
    setKind(k);
    setFacets(NO_FACETS);
    setVocals("");
    setTempo("");
    setLength("");
    setSimilar(null);
  }

  function play(it: Item) {
    const a = audio.current;
    if (!a) return;
    if (playing?.id === it.id) {
      if (a.paused) void a.play();
      else a.pause();
      return;
    }
    a.src = it.previewUrl;
    setPlaying(it);
    setPos(0);
    void a.play().catch(() => {});
  }
  function seek(it: Item, frac: number) {
    const a = audio.current;
    if (!a) return;
    if (playing?.id !== it.id) {
      play(it);
      a.addEventListener("loadedmetadata", () => (a.currentTime = frac * (a.duration || it.seconds)), { once: true });
    } else a.currentTime = frac * (a.duration || it.seconds);
  }
  function step(dir: 1 | -1) {
    const list = data?.items.filter((x) => x.kind !== "footage") ?? [];
    const i = list.findIndex((x) => x.id === playing?.id);
    const next = list[i + dir];
    if (next) play(next);
  }

  async function act(body: Record<string, unknown>, done?: string) {
    try {
      const r = await api<Record<string, unknown>>("/api/library", { body });
      if (done) toast(done, "success");
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    }
  }
  async function favorite(it: Item) {
    const r = await act({ action: "favorite", id: it.id });
    if (r) setData((d) => d && { ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, favorite: !!r.favorite } : x)).filter((x) => shelf !== "favorites" || x.favorite) });
  }
  async function getFile(it: Item) {
    try {
      setDownload({ item: it, ...(await api<{ url: string; fileName: string; license: string }>("/api/library/download", { body: { id: it.id } })) });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const tags = kind === "music"
    ? ([["genres", "Genre", GENRES], ["moods", "Mood", MOODS], ["themes", "Video type", THEMES], ["instruments", "Instrument", INSTRUMENTS]] as const)
    : ([["categories", "Category", kind === "sfx" ? SFX_CATEGORIES : FOOTAGE_CATEGORIES]] as const);
  const active = Object.values(facets).flat().length + (vocals ? 1 : 0) + (tempo ? 1 : 0) + (length ? 1 : 0);
  const board = data?.boards.find((b) => b.id === boardId);

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Music, sound effects and footage for your videos: search, preview, save to boards, and download with a license that covers commercial use."
        actions={<Link href={`/create?kind=${kind}`}><Button variant="primary"><Sparkles className="h-4 w-4" /> Make with AI</Button></Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["music", "sfx", "footage"] as AssetKind[]).map((k) => (
          <button key={k} onClick={() => switchKind(k)} className={cn("rounded-full px-4 py-2 text-sm font-medium transition", !luts && kind === k ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>
            {KIND_LABEL[k]}
          </button>
        ))}
        <button onClick={() => setLuts(true)} className={cn("rounded-full px-4 py-2 text-sm font-medium transition", luts ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>LUTs</button>
      </div>
      {luts ? <LutGallery canDownload={!!data?.canDownload} /> : <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {([["all", "Everything"], ["catalog", "Catalog"], ["mine", "My creations"], ["favorites", "Favorites"]] as [Shelf, string][]).map(([s, label]) => (
          <button key={s} onClick={() => { setShelf(s); setSimilar(null); }} className={cn("rounded-lg px-3 py-1.5", shelf === s ? "bg-white/15 text-white" : "text-white/60 hover:text-white")}>
            {s === "favorites" && <Heart className="mr-1 inline h-3.5 w-3.5" />}{label}
          </button>
        ))}
        {!!data?.boards.length && (
          <Select className="w-auto" value={shelf === "board" ? boardId : ""} onChange={(e) => { if (e.target.value) { setShelf("board"); setBoardId(e.target.value); } else setShelf("all"); }}>
            <option value="">Boards…</option>
            {data.boards.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.count})</option>)}
          </Select>
        )}
        {shelf === "board" && board && (
          <Button variant="ghost" size="sm" onClick={async () => { if (confirm(`Delete the board “${board.name}”? The items stay in the Library.`) && (await act({ action: "board-delete", boardId }, "Board deleted"))) { setShelf("all"); load(); } }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete board
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input className="pl-9" placeholder={kind === "music" ? "Search by mood, genre, instrument, title…" : kind === "sfx" ? "Search sounds: rain, door slam, whoosh…" : "Search clips: city at night, ocean, office…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)} disabled={!!similar}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        <Button variant="ghost" onClick={() => setShowFilters((v) => !v)}>
          <ListFilter className="h-4 w-4" /> Filters{active ? ` (${active})` : ""}
        </Button>
      </div>

      {data?.isAdmin && shelf === "catalog" && kind !== "footage" && <FillCatalog kind={kind} engine={data.engine} />}
      {similar && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-mint-400/30 bg-mint-400/10 px-4 py-2 text-sm">
          <Sparkles className="h-4 w-4 text-mint-300" /> More like <b>{similar.title}</b>
          <button className="ml-auto text-white/60 hover:text-white" onClick={() => setSimilar(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {showFilters && (
        <Card className="mb-4 grid grid-cols-1 gap-4 p-4">
          {tags.map(([key, label, list]) => (
            <div key={key}>
              <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">{label}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((t) => {
                  const on = facets[key].includes(t);
                  return (
                    <button key={t} onClick={() => setFacets((f) => ({ ...f, [key]: on ? f[key].filter((x) => x !== t) : [...f[key], t] }))}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-mint-400 bg-mint-400/15 text-mint-200" : "border-white/10 text-white/60 hover:border-white/30")}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            {kind === "music" && (
              <>
                <Select className="w-auto" value={vocals} onChange={(e) => setVocals(e.target.value)}>
                  <option value="">Vocals and instrumental</option>
                  <option value="instrumental">Instrumental only</option>
                  <option value="vocals">With vocals</option>
                </Select>
                <Select className="w-auto" value={tempo} onChange={(e) => setTempo(e.target.value)}>
                  <option value="">Any tempo</option>
                  {TEMPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </>
            )}
            {kind !== "footage" && (
              <Select className="w-auto" value={length} onChange={(e) => setLength(e.target.value)}>
                <option value="">Any length</option>
                {LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </Select>
            )}
            {active > 0 && <Button variant="ghost" size="sm" onClick={() => { setFacets(NO_FACETS); setVocals(""); setTempo(""); setLength(""); }}>Clear filters</Button>}
          </div>
        </Card>
      )}

      {!data ? (
        <div className="grid grid-cols-1 place-items-center py-20"><Spinner /></div>
      ) : !data.items.length ? (
        <Empty
          icon={<LibraryIcon className="h-6 w-6" />}
          title={shelf === "favorites" ? "No favorites yet" : shelf === "mine" ? `You haven't made any ${KIND_LABEL[kind].toLowerCase()} yet` : "Nothing matches"}
          body={shelf === "favorites" ? "Tap the heart on anything in the Library to keep it here." : data.engine ? "Make something new with the AI generators: it lands here with a title, tags and a license." : "The AI generators need Ghost Post's engine; the admin connects it in Admin → App settings → Integrations."}
          action={<Link href={`/create?kind=${kind}`}><Button variant="primary"><Wand2 className="h-4 w-4" /> Make {kind === "music" ? "a track" : kind === "sfx" ? "a sound" : "a clip"}</Button></Link>}
        />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs text-white/40">
            {loading && <Spinner className="h-3 w-3" />} {data.total} {data.total === 1 ? "result" : "results"}
            {!data.canDownload && <span className="ml-auto">Free plan: preview and save. <Link href="/plans" className="text-mint-300 underline">Upgrade</Link> to download.</span>}
          </div>
          {kind === "footage" ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {data.items.map((it) => (
                <Card key={it.id} id={`item-${it.id}`} className="overflow-hidden">
                  <video src={it.previewUrl} poster={it.posterUrl} muted loop playsInline preload="none" className={cn("w-full bg-black object-cover", it.aspect === "9:16" ? "aspect-[9/16]" : it.aspect === "1:1" ? "aspect-square" : "aspect-video")}
                    onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())} />
                  <div className="p-3">
                    <div className="truncate text-sm font-medium">{it.title}</div>
                    <div className="mt-0.5 truncate text-xs text-white/50">{[it.category, it.aspect, `${it.seconds}s`].filter(Boolean).join(" · ")}</div>
                    <Actions it={it} data={data} onFav={favorite} onBoard={setBoardFor} onDownload={getFile} onSimilar={setSimilar} onAct={act} reload={load} />
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="divide-y divide-white/5">
              {data.items.map((it) => (
                <div key={it.id} id={`item-${it.id}`} className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3 md:grid-cols-[auto_minmax(0,240px)_minmax(0,1fr)_auto]", playing?.id === it.id && "bg-white/[0.04]")}>
                  <button onClick={() => play(it)} className="grid grid-cols-1 h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-mint-400 hover:text-ink-950" aria-label={playing?.id === it.id && !paused ? "Pause" : "Play"}>
                    {playing?.id === it.id && !paused ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{it.title}</span>{it.mine && <Badge tone="neutral" className="shrink-0">Mine</Badge>}</div>
                    <div className="truncate text-xs text-white/50">{(kind === "music" ? [...it.genres, ...it.moods] : [it.category]).filter(Boolean).join(" · ") || it.description}</div>
                  </div>
                  <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                    <Wave peaks={it.peaks} progress={playing?.id === it.id ? pos / it.seconds : 0} onSeek={(f) => seek(it, f)} />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/50">{fmtDuration(it.seconds)}</span>
                    {kind === "music" && <span className="hidden w-16 shrink-0 text-xs text-white/40 lg:block">{it.bpm ? `${it.bpm} BPM` : ""}</span>}
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <Actions it={it} data={data} onFav={favorite} onBoard={setBoardFor} onDownload={getFile} onSimilar={setSimilar} onAct={act} reload={load} />
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      </>}
      {/* The player stays at the bottom while you browse. */}
      <audio ref={audio} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onEnded={() => step(1)} />
      {playing && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-40 border-t border-white/10 bg-ink-950/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <button onClick={() => play(playing)} className="grid grid-cols-1 h-10 w-10 shrink-0 place-items-center rounded-full bg-mint-400 text-ink-950" aria-label={paused ? "Play" : "Pause"}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <div className="w-40 min-w-0 shrink-0">
              <div className="truncate text-sm font-medium">{playing.title}</div>
              <div className="text-xs tabular-nums text-white/50">{fmtDuration(pos)} / {fmtDuration(playing.seconds)}</div>
            </div>
            <Wave peaks={playing.peaks} progress={pos / playing.seconds} onSeek={(f) => seek(playing, f)} tall />
            <button className="shrink-0 text-white/50 hover:text-white" onClick={() => { audio.current?.pause(); setPlaying(null); }} aria-label="Close player"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {download && (
        <Modal onClose={() => setDownload(null)} title={`Download “${download.item.title}”`}>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-white/70">{download.license}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={download.url} download={download.fileName}><Button variant="primary"><Download className="h-4 w-4" /> Download {download.fileName.split(".").pop()?.toUpperCase()}</Button></a>
            <a href={`/api/library/license?id=${download.item.id}`}><Button variant="ghost"><FileText className="h-4 w-4" /> Download license</Button></a>
          </div>
        </Modal>
      )}
      {boardFor && data && <BoardPicker item={boardFor} boards={data.boards} onClose={() => setBoardFor(null)} onAct={act} reload={load} />}
      {playing && <div className="h-36 lg:h-20" />}
    </>
  );
}

/** Admins: have the engine fill the shared catalog from Ghost Post's recipe list. */
function FillCatalog({ kind, engine }: { kind: "music" | "sfx"; engine: boolean }) {
  const { toast } = useApp();
  const [status, setStatus] = useState<{ music: { left: number; inCatalog: number }; sfx: { left: number; inCatalog: number } } | null>(null);
  const [count, setCount] = useState("25");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<NonNullable<typeof status>>("/api/library", { body: { action: "fill-status" } }).then(setStatus).catch(() => {});
  }, [kind]);
  const s = status?.[kind];
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
      <Sparkles className="h-4 w-4 text-mint-300" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Fill the catalog</div>
        <div className="text-xs text-white/50">
          {s ? `${s.inCatalog} in the catalog now; ${s.left} more ${kind === "music" ? "genre and mood recipes" : "sound recipes"} ready to make.` : "…"} Made on your engine in the background, free for admins.
        </div>
      </div>
      <Select className="w-auto" value={count} onChange={(e) => setCount(e.target.value)}>
        {["10", "25", "50", "100"].map((n) => <option key={n} value={n}>{n}</option>)}
      </Select>
      <Button variant="primary" loading={busy} disabled={!engine || s?.left === 0} onClick={async () => {
        setBusy(true);
        try {
          await api("/api/library", { body: { action: "fill-catalog", kind, count: Number(count) } });
          jobStarted();
          toast("Started. New items appear in the catalog as the job finishes.", "success");
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}>Make {count} {kind === "music" ? "tracks" : "sounds"}</Button>
    </Card>
  );
}

function Actions({ it, data, onFav, onBoard, onDownload, onSimilar, onAct, reload }: {
  it: Item; data: Data; onFav: (i: Item) => void; onBoard: (i: Item) => void; onDownload: (i: Item) => void; onSimilar: (i: Item) => void;
  onAct: (b: Record<string, unknown>, done?: string) => Promise<Record<string, unknown> | null>; reload: () => void;
}) {
  const btn = "grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white";
  return (
    <div className="mt-1 flex items-center justify-end gap-0.5">
      <button className={btn} title="More like this" onClick={() => onSimilar(it)}><Sparkles className="h-4 w-4" /></button>
      <button className={cn(btn, it.favorite && "text-red-400")} title={it.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => onFav(it)}><Heart className={cn("h-4 w-4", it.favorite && "fill-current")} /></button>
      <button className={btn} title="Add to a board" onClick={() => onBoard(it)}><FolderPlus className="h-4 w-4" /></button>
      <button className={cn(btn, !data.canDownload && "opacity-50")} title={data.canDownload ? "Download with license" : "Downloads come with paid plans"} onClick={() => onDownload(it)}><Download className="h-4 w-4" /></button>
      {data.isAdmin && it.mine && (
        <button className={btn} title="Publish to the catalog for every subscriber" onClick={async () => { if (await onAct({ action: "publish", id: it.id }, "Published to the catalog")) reload(); }}><Upload className="h-4 w-4" /></button>
      )}
      {(it.mine || data.isAdmin) && (
        <button className={btn} title="Delete" onClick={async () => { if (confirm(`Delete “${it.title}”? This can't be undone.`) && (await onAct({ action: "delete", id: it.id }, "Deleted"))) reload(); }}><Trash2 className="h-4 w-4" /></button>
      )}
    </div>
  );
}

/** The track's loudness as bars; click to jump there. */
function Wave({ peaks, progress, onSeek, tall }: { peaks: number[]; progress: number; onSeek: (f: number) => void; tall?: boolean }) {
  const n = peaks.length || 1;
  const h = tall ? 36 : 28;
  return (
    <svg viewBox={`0 0 ${n * 3} ${h}`} preserveAspectRatio="none" className={cn("min-w-0 flex-1 cursor-pointer", tall ? "h-9" : "h-7")}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}>
      {peaks.map((p, i) => {
        const bh = Math.max(1.5, p * (h - 2));
        return <rect key={i} x={i * 3} y={(h - bh) / 2} width={2} height={bh} rx={1} className={i / n < progress ? "fill-mint-400" : "fill-white/25"} />;
      })}
    </svg>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid grid-cols-1 place-items-center bg-black/70 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <div className="font-semibold">{title}</div>
          <button className="ml-auto text-white/50 hover:text-white" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </Card>
    </div>
  );
}

function BoardPicker({ item, boards, onClose, onAct, reload }: {
  item: Item; boards: Data["boards"]; onClose: () => void; onAct: (b: Record<string, unknown>, done?: string) => Promise<Record<string, unknown> | null>; reload: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal title={`Add “${item.title}” to a board`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-1.5">
        {boards.map((b) => (
          <button key={b.id} className="rounded-lg bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
            onClick={async () => { if (await onAct({ action: "board-add", boardId: b.id, id: item.id }, `Added to ${b.name}`)) { onClose(); reload(); } }}>
            {b.name} <span className="text-white/40">({b.count})</span>
          </button>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => {
        e.preventDefault();
        const r = await onAct({ action: "board-create", name });
        const id = (r?.board as { id?: string } | undefined)?.id;
        if (id && (await onAct({ action: "board-add", boardId: id, id: item.id }, `Added to ${name}`))) { onClose(); reload(); }
      }}>
        <Input placeholder="New board, e.g. Episode 2 score" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>Create</Button>
      </form>
    </Modal>
  );
}
