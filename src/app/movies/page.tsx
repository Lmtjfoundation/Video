"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clapperboard, Film, ImagePlus, Lightbulb, Sparkles, Trash2, UserRound, Users } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, EXPLAIN_HANDOFF, FILM_HANDOFF } from "@/lib/client";
import { CREDIT_COST } from "@/lib/plans";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import type { AnimationEngine, Character, Placement, Platform, Post } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lengthAllowed, MAX_VEO_SCENES, MOVIE_LENGTHS, MOVIE_SHAPE, movieEstimate, renderCredits, type MovieLength } from "@/lib/video-spec";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";

type CharacterWithUrl = Character & { imageUrl: string };
type Library = { characters: CharacterWithUrl[]; looks: string[]; ready: boolean; seedance?: boolean };

const MOVIE_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube", "facebook", "x", "linkedin"];

export default function MovieStudio() {
  const { status, toast, refresh } = useApp();
  const admin = status?.me.user.role === "admin";
  const [lib, setLib] = useState<Library | null>(null);
  const [videos, setVideos] = useState<Post[]>([]);

  const load = useCallback(async () => {
    try {
      const [l, posts] = await Promise.all([api<Library>("/api/characters"), api<Post[]>("/api/posts")]);
      setLib(l);
      setVideos(posts.filter((p) => p.video?.ai).slice(0, 12));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Movie Studio"
        subtitle="Turn photos into characters, then make short films and explainer videos with AI pictures, Veo-animated scenes, voiceover and captions."
        actions={<Link href="/explain"><Button variant="secondary"><Lightbulb className="h-4 w-4" /> Explain a text</Button></Link>}
      />
      {lib && !lib.ready && (
        <div className="mb-5 rounded-xl bg-gold-400/[0.08] p-4 text-sm text-gold-300 ring-1 ring-gold-300/25">
          {admin
            ? "Add a Gemini API key in Admin → App settings → Integrations to switch this on. Pictures and Veo clips are billed by Google on that key's project, so turn billing on there."
            : "Movie Studio isn't switched on yet. The app's owner needs to connect Google Gemini."}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <CharactersCard lib={lib} admin={admin} creditsLeft={status?.me.creditsLeft} onChange={() => { load(); refresh(); }} />
        <MovieCard lib={lib} admin={admin} creditsLeft={status?.me.creditsLeft} onMade={(p) => { setVideos((v) => [p, ...v]); refresh(); }} />
      </div>
      <Card className="mt-5">
        <CardHeader title="Your AI videos" subtitle="Open one to watch the render, edit the caption, schedule it or post it." icon={<Film className="h-4 w-4" />} />
        <div className="p-5">
          {videos.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((p) => (
                <Link key={p.id} href={`/post/${p.id}`} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06] transition hover:bg-white/[0.06]">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={p.video?.style === "fiction" ? "violet" : "mint"}>{p.video?.style === "fiction" ? "Movie" : "Explainer"}</Badge>
                    <Badge>{PLATFORM_SPECS[p.platform].name}</Badge>
                    {p.render?.status === "done" && <Badge tone="mint">Rendered</Badge>}
                    {(p.render?.status === "queued" || p.render?.status === "rendering") && <Badge tone="gold">Rendering {p.render.progress}%</Badge>}
                    {p.render?.status === "failed" && <Badge tone="red">Render failed</Badge>}
                  </div>
                  <p className="line-clamp-2 text-sm font-medium text-white">{p.hook}</p>
                  <p className="mt-1 text-xs text-white/45">{p.video?.scenes.length} scenes · {p.video?.ai?.veoScenes.length ?? 0} animated · render {renderCredits(p.video)} credits</p>
                </Link>
              ))}
            </div>
          ) : (
            <Empty icon={<Clapperboard className="h-5 w-5" />} title="No AI videos yet" body="Write your first movie or explainer above. It appears here as a draft you can render, schedule and post." />
          )}
        </div>
      </Card>
    </div>
  );
}

function costLine(admin: boolean, creditsLeft: number | undefined, cost: string) {
  if (admin) return "Owner account · no credits used";
  return creditsLeft === undefined ? `Costs ${cost}` : `${creditsLeft.toLocaleString()} credits left · this costs ${cost}`;
}

function CharactersCard({ lib, admin, creditsLeft, onChange }: { lib: Library | null; admin: boolean; creditsLeft?: number; onChange: () => void }) {
  const toast = useApp((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [look, setLook] = useState("");
  const [customLook, setCustomLook] = useState("");
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const looks = lib?.looks ?? [];
  const chosenLook = look === "custom" ? customLook : look || looks[0] || "";

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const data = (await res.json()) as { saved?: { id: string; url: string }[]; errors?: string[]; error?: string };
      if (!res.ok || !data.saved?.length) throw new Error(data.error ?? data.errors?.[0] ?? "Upload failed.");
      setPhoto({ id: data.saved[0].id, url: data.saved[0].url });
      setConsent(false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      await api("/api/characters", { body: { name, description, look: chosenLook, photoId: photo?.id, consent } });
      toast(`${name} is ready.`, "success");
      setName("");
      setDescription("");
      setPhoto(null);
      setConsent(false);
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: CharacterWithUrl) {
    if (!confirm(`Delete ${c.name}? Videos already rendered keep their pictures.`)) return;
    try {
      await api(`/api/characters?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const canCreate = !!name.trim() && (!!photo || !!description.trim()) && (!photo || consent) && !!chosenLook.trim() && !!lib?.ready;
  return (
    <Card>
      <CardHeader title="Characters" subtitle="Made once, the same in every scene: each character's portrait guides every picture they appear in." icon={<Users className="h-4 w-4" />} />
      <div className="grid gap-5 p-5">
        {lib?.characters.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {lib.characters.map((c) => (
              <div key={c.id} className="group overflow-hidden rounded-xl bg-ink-950/60 ring-1 ring-white/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt={`${c.name}, character portrait`} className="aspect-[9/16] w-full object-cover" loading="lazy" />
                <div className="flex items-start justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{c.name}</p>
                    <p className="truncate text-[11px] text-white/45" title={c.look}>{c.look}</p>
                  </div>
                  <button onClick={() => remove(c)} className="rounded-md p-1 text-white/35 hover:bg-red-500/10 hover:text-red-300" aria-label={`Delete ${c.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={<UserRound className="h-5 w-5" />} title="No characters yet" body="Upload a photo (of you, a pet, a toy, or anyone who said yes) or describe someone new." />
        )}

        <div className="grid gap-4 rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]">
          <p className="text-sm font-medium text-white">New character</p>
          <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-ink-950/50 text-white/45 hover:border-mint-300/40 hover:text-mint-300"
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Uploaded photo" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1.5 px-2 text-center text-xs">
                  <ImagePlus className="h-5 w-5" /> {uploading ? "Uploading…" : "Add a photo (optional)"}
                </span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <div className="grid gap-3">
              <Field label="Name">
                <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya" />
              </Field>
              <Field label="Art style">
                <Select value={look || looks[0] || ""} onChange={(e) => setLook(e.target.value)}>
                  {looks.map((l) => <option key={l} value={l}>{l}</option>)}
                  <option value="custom">Something else…</option>
                </Select>
              </Field>
              {look === "custom" && <Input value={customLook} maxLength={160} onChange={(e) => setCustomLook(e.target.value)} placeholder="e.g. 1990s Saturday-morning cartoon" />}
            </div>
          </div>
          <Field label={photo ? "Anything to add (optional)" : "What they look like"} hint={photo ? "Outfit, personality, or changes from the photo." : "Hair, skin tone, build, clothes, colors, anything distinctive."}>
            <Textarea rows={3} maxLength={900} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={photo ? "Wears a yellow raincoat; always curious" : "A tall woman in her 30s with curly black hair, warm brown skin, round glasses and a green bomber jacket"} />
          </Field>
          {photo && (
            <label className="flex items-start gap-2 text-xs text-white/65">
              <input type="checkbox" className="mt-0.5 accent-mint-400" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              This photo is of me, or I have permission from the person in it. I won&apos;t use it to impersonate anyone.
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/45">{costLine(admin, creditsLeft, `${CREDIT_COST.character} credits`)}</p>
            <Button variant="primary" loading={busy} disabled={!canCreate} onClick={create}>
              <Sparkles className="h-4 w-4" /> Create character
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MovieCard({ lib, admin, creditsLeft, onMade }: { lib: Library | null; admin: boolean; creditsLeft?: number; onMade: (p: Post) => void }) {
  const toast = useApp((s) => s.toast);
  const [kind, setKind] = useState<"movie" | "explainer">("movie");
  const [brief, setBrief] = useState("");
  const [cast, setCast] = useState<string[]>([]);
  const [look, setLook] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [length, setLength] = useState<MovieLength>("s60");
  const [veo, setVeo] = useState(3);
  const [engine, setEngine] = useState<AnimationEngine>("veo");
  const engineName = engine === "seedance" ? "Seedance 2.5" : "Veo";
  const [renderNow, setRenderNow] = useState(true);
  const settings = useApp((s) => s.status?.settings);
  const [autoPost, setAutoPost] = useState(false);
  const [placement, setPlacement] = useState<Placement>("auto");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ post: Post; note: string } | null>(null);
  const hasPlacement = platform === "instagram" || platform === "facebook";
  useEffect(() => {
    if (settings) setAutoPost(settings.autoPost?.enabled ?? false);
  }, [settings?.autoPost?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (settings && (platform === "instagram" || platform === "facebook")) setPlacement(settings.autoPost?.[platform] ?? "auto");
  }, [platform, settings?.autoPost]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const text = sessionStorage.getItem(EXPLAIN_HANDOFF);
      if (text) {
        sessionStorage.removeItem(EXPLAIN_HANDOFF);
        setKind("explainer");
        setBrief(text);
      }
      const film = sessionStorage.getItem(FILM_HANDOFF);
      if (film) {
        sessionStorage.removeItem(FILM_HANDOFF);
        setKind("movie");
        setBrief(String((JSON.parse(film) as { brief?: string }).brief ?? ""));
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const est = movieEstimate(length, veo, engine);
  const chars = lib?.characters ?? [];
  const firstLook = chars.find((c) => cast.includes(c.id))?.look ?? lib?.looks[0] ?? "";
  const lengthOk = lengthAllowed(length, platform);

  async function make() {
    setBusy(true);
    setMade(null);
    try {
      const r = await api<{ post: Post; note: string }>("/api/movies", { body: { kind, brief, characterIds: cast, look: look || firstLook, platform, length, veoScenes: veo, engine, renderNow: renderNow || autoPost, autoPost, placement: hasPlacement ? placement : undefined } });
      setMade(r);
      onMade(r.post);
      toast(r.post.render?.status === "queued" ? (r.post.autoPost ? "Script written. Rendering — it posts itself when ready." : "Script written. Rendering has started.") : "Script written and saved as a draft.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={kind === "movie" ? "Make a movie" : "Make an explainer video"}
        subtitle={costLine(admin, creditsLeft, `about ${est.low}–${est.high} credits${renderNow ? "" : ` (script only: a few credits now, the rest when you render)`}`)}
        icon={<Clapperboard className="h-4 w-4" />}
      />
      <div className="grid gap-4 p-5">
        <div className="inline-flex w-fit rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
          {(["movie", "explainer"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cn("rounded-lg px-4 py-1.5 text-sm transition", kind === k ? "bg-white/[0.1] text-white" : "text-white/55 hover:text-white")}>
              {k === "movie" ? "Short film" : "Explainer"}
            </button>
          ))}
        </div>
        <Field label={kind === "movie" ? "Story idea" : "Text to explain"} hint={kind === "movie" ? "A sentence or two: who, what they want, what goes wrong." : "An article, notes, a policy, a lesson. The video explains it simply and stays faithful to it."}>
          <Textarea rows={kind === "movie" ? 4 : 8} maxLength={12000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={kind === "movie" ? "Maya finds a talking houseplant that only tells the truth, the day before her big job interview." : "Paste the text here…"} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-white/80">Cast <span className="font-normal text-white/40">(up to 6)</span></p>
          {chars.length ? (
            <div className="flex flex-wrap gap-2">
              {chars.map((c) => {
                const on = cast.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setCast((x) => (on ? x.filter((id) => id !== c.id) : x.length < 6 ? [...x, c.id] : x))}
                    className={cn("flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm ring-1 transition", on ? "bg-mint-400/15 text-white ring-mint-300/40" : "bg-white/[0.03] text-white/65 ring-white/[0.08] hover:text-white")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.imageUrl} alt="" className="h-7 w-7 rounded-full object-cover object-top" />
                    {c.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-white/45">No characters yet. Create some on the left, or go without: scenes will show places, objects and anonymous figures.</p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Art style">
            <Select value={look || firstLook} onChange={(e) => setLook(e.target.value)}>
              {[...new Set([firstLook, ...(lib?.looks ?? []), ...chars.map((c) => c.look)].filter(Boolean))].map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Platform">
            <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {MOVIE_PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}
            </Select>
          </Field>
          <Field label="Length">
            <Select value={length} onChange={(e) => setLength(e.target.value as MovieLength)}>
              {MOVIE_LENGTHS.map((l) => <option key={l} value={l}>{MOVIE_SHAPE[l].label} · {MOVIE_SHAPE[l].scenes} scenes</option>)}
            </Select>
          </Field>
          <Field label="Animate with" hint={lib?.seedance ? "Seedance 2.5 makes longer, richer motion; it costs about twice as much" : "Seedance 2.5 switches on when the admin adds a Replicate token"}>
            <Select value={engine} onChange={(e) => setEngine(e.target.value as AnimationEngine)}>
              <option value="veo">Google Veo 3.1 · {CREDIT_COST.veoSecond} credits a second</option>
              <option value="seedance" disabled={!lib?.seedance}>ByteDance Seedance 2.5 · {CREDIT_COST.seedanceSecond} credits a second{lib?.seedance ? "" : " (not connected)"}</option>
            </Select>
          </Field>
          <Field label={`Animated scenes: ${veo}`} hint={veo ? "Real motion for the key moments; other scenes get a slow camera move." : "Pictures with slow camera moves only (cheapest)."}>
            <input type="range" min={0} max={MAX_VEO_SCENES} value={veo} onChange={(e) => setVeo(Number(e.target.value))} className="mt-2 w-full accent-mint-400" />
          </Field>
        </div>
        {!lengthOk && <p className="text-xs text-red-300">X allows videos up to 2 minutes 20 seconds. Pick a shorter length for X.</p>}
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" className="accent-mint-400" checked={renderNow || autoPost} disabled={autoPost} onChange={(e) => setRenderNow(e.target.checked)} />
          Render the video right after writing it
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" className="accent-mint-400" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
          Post automatically when it&apos;s rendered (to your connected {PLATFORM_SPECS[platform].name})
        </label>
        {autoPost && hasPlacement && (
          <Field label="Post as" hint={platform === "facebook" ? "Auto: Reels up to 90 s, longer videos to the feed" : "Auto: Reel, shown in Reels and the feed"}>
            <Select value={placement} onChange={(e) => setPlacement(e.target.value as Placement)}>
              <option value="auto">Auto (best fit)</option>
              <option value="reel">Reel</option>
              <option value="feed">Feed video</option>
              <option value="story">Story (up to 60 s)</option>
            </Select>
          </Field>
        )}
        <p className="text-xs leading-relaxed text-white/40">
          Each scene picture is {CREDIT_COST.aiImage} credits; each {engineName} scene is {engine === "seedance" ? CREDIT_COST.seedanceSecond : CREDIT_COST.veoSecond} credits a second (4–8 seconds). Scenes that can&apos;t be made are refunded automatically. Rendering takes a few minutes; animation adds about 1–3 minutes a clip.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" size="lg" loading={busy} disabled={!lib?.ready || !lengthOk || brief.trim().length < (kind === "movie" ? 10 : 40)} onClick={make}>
            <Film className="h-4 w-4" /> {kind === "movie" ? "Write the movie" : "Write the explainer"}
          </Button>
        </div>
        {made && (
          <div className="rounded-xl bg-mint-400/[0.06] p-4 text-sm ring-1 ring-mint-300/20">
            <p className="font-medium text-white">{made.post.hook}</p>
            <p className="mt-1 text-xs text-white/55">
              {made.post.video?.scenes.length} scenes · {made.post.video?.ai?.veoScenes.length ?? 0} animated · render {renderCredits(made.post.video)} credits
              {made.note ? ` · ${made.note}` : ""}
            </p>
            <Link href={`/post/${made.post.id}`} className="mt-2 inline-block text-xs text-sky-300 hover:underline">Open it to watch the render, edit and schedule →</Link>
          </div>
        )}
      </div>
    </Card>
  );
}
