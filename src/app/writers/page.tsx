"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, BookOpen, Clapperboard, Copy, Feather, Globe2, Megaphone, PenLine, Sparkles, Trash2, Users } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard, FILM_HANDOFF } from "@/lib/client";
import { CREDIT_COST } from "@/lib/plans";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import type { Platform } from "@/lib/types";
import type { FilmFormat, FilmProject } from "@/lib/writers-room";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";

type Library = { films: FilmProject[]; genres: string[]; formats: FilmFormat[]; max: number };
const FORMAT_LABEL: Record<FilmFormat, string> = { short: "Short film", feature: "Feature film", series: "Series pilot" };
const FORMAT_HINT: Record<FilmFormat, string> = { short: "5–15 minutes", feature: "90–110 minutes", series: "Pilot + season arc" };
const TABS = [
  { id: "story", label: "Story", icon: BookOpen },
  { id: "characters", label: "Characters", icon: Users },
  { id: "world", label: "World", icon: Globe2 },
  { id: "script", label: "Outline & script", icon: PenLine },
  { id: "review", label: "Review", icon: Award },
  { id: "promote", label: "Promote & make", icon: Megaphone },
] as const;
type Tab = (typeof TABS)[number]["id"];
const PROMO_PLATFORMS: Platform[] = ["instagram", "facebook", "tiktok", "youtube", "x", "linkedin"];
const devCost = (f: FilmFormat) => (f === "short" ? CREDIT_COST.filmDevelop : CREDIT_COST.filmDevelopLong);

export default function WritersRoom() {
  const { toast, refresh } = useApp();
  const [lib, setLib] = useState<Library | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const l = await api<Library>("/api/films");
      setLib(l);
      setOpenId((cur) => cur ?? l.films[0]?.id ?? null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const put = (f: FilmProject) => {
    setLib((l) => (l ? { ...l, films: [f, ...l.films.filter((x) => x.id !== f.id)] } : l));
    setOpenId(f.id);
    refresh();
  };
  const open = lib?.films.find((f) => f.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Writers' Room"
        subtitle="Develop an original film like a professional room: title, logline, theme, world, characters with full backstories, structure, scene outline, screenplay pages, an honest awards-readiness review and a promotion kit. Then make it in Movie Studio."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <NewProject lib={lib} onMade={put} />
          <Card>
            <CardHeader title="Your projects" subtitle={lib ? `${lib.films.length} of ${lib.max}` : undefined} icon={<Feather className="h-4 w-4" />} />
            <div className="grid gap-1.5 p-3">
              {lib?.films.length ? (
                lib.films.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setOpenId(f.id)}
                    className={cn("focus-ring rounded-xl p-3 text-left ring-1 transition", f.id === openId ? "bg-white/[0.06] ring-mint-400/30" : "ring-white/[0.06] hover:bg-white/[0.03]")}
                  >
                    <p className="truncate text-sm font-medium text-white">{f.title}</p>
                    <p className="mt-0.5 truncate text-[12px] text-white/50">{f.genre} · {FORMAT_LABEL[f.format]}{f.review ? ` · reviewed ${avg(f)}/10` : ""}</p>
                  </button>
                ))
              ) : (
                <p className="p-2 text-[13px] text-white/45">No projects yet. Start one above.</p>
              )}
            </div>
          </Card>
        </div>
        {open ? (
          <Project key={open.id} film={open} onChange={put} onDeleted={() => { setLib((l) => (l ? { ...l, films: l.films.filter((x) => x.id !== open.id) } : l)); setOpenId(null); }} />
        ) : (
          <Card>
            <Empty icon={<Clapperboard className="h-6 w-6" />} title="Start with an idea" body="One or two sentences is enough: who it's about and what happens. The room builds everything else, and you can revise it with your own notes." />
          </Card>
        )}
      </div>
    </div>
  );
}

const avg = (f: FilmProject) => (f.review ? (f.review.scores.reduce((s, x) => s + x.score, 0) / f.review.scores.length).toFixed(1) : "");

function NewProject({ lib, onMade }: { lib: Library | null; onMade: (f: FilmProject) => void }) {
  const toast = useApp((s) => s.toast);
  const [premise, setPremise] = useState("");
  const [genre, setGenre] = useState("Drama");
  const [format, setFormat] = useState<FilmFormat>("short");
  const [tone, setTone] = useState("");
  const [influences, setInfluences] = useState("");
  const [busy, setBusy] = useState(false);
  async function develop() {
    setBusy(true);
    try {
      const f = await api<FilmProject>("/api/films", { body: { action: "develop", premise, genre, format, tone, influences } });
      toast(`“${f.title}” is ready to read`, "success");
      setPremise("");
      onMade(f);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="New project" subtitle="Original fiction only" icon={<Sparkles className="h-4 w-4" />} />
      <div className="grid gap-3 p-5">
        <Field label="Your idea">
          <Textarea rows={4} value={premise} onChange={(e) => setPremise(e.target.value)} maxLength={4000} placeholder="A divorced couple has to split the one thing they both refuse to give up: the house where their son learned to walk…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Genre">
            <Select value={genre} onChange={(e) => setGenre(e.target.value)}>
              {(lib?.genres ?? ["Drama"]).map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="Format" hint={FORMAT_HINT[format]}>
            <Select value={format} onChange={(e) => setFormat(e.target.value as FilmFormat)}>
              {(lib?.formats ?? ["short"]).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Tone (optional)">
          <Input value={tone} onChange={(e) => setTone(e.target.value)} maxLength={200} placeholder="Tender and funny, then devastating" />
        </Field>
        <Field label="The feel of (optional)" hint="Mood only — no copying">
          <Input value={influences} onChange={(e) => setInfluences(e.target.value)} maxLength={300} placeholder="Moonlight, Fences, Atlanta" />
        </Field>
        <Button variant="primary" size="lg" loading={busy} disabled={premise.trim().length < 15} onClick={develop}>
          <Feather className="h-4 w-4" /> Develop it · {devCost(format)} credits
        </Button>
        {busy && <p className="text-[12px] text-white/45">The room is writing — a feature or series takes up to two minutes.</p>}
      </div>
    </Card>
  );
}

function Project({ film, onChange, onDeleted }: { film: FilmProject; onChange: (f: FilmProject) => void; onDeleted: () => void }) {
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<Tab>("story");
  const [busy, setBusy] = useState<string | null>(null);
  const [logline, setLogline] = useState(film.logline);
  const [confirmDel, setConfirmDel] = useState(false);

  async function act(key: string, b: Record<string, unknown>, ok?: string) {
    setBusy(key);
    try {
      const f = await api<FilmProject>("/api/films", { body: { id: film.id, ...b } });
      onChange(f);
      if (ok) toast(ok, "success");
      return f;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function patch(b: Record<string, unknown>, ok: string) {
    try {
      onChange(await api<FilmProject>("/api/films", { method: "PATCH", body: { id: film.id, ...b } }));
      toast(ok, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function remove() {
    if (!confirmDel) return setConfirmDel(true);
    try {
      await api(`/api/films?id=${film.id}`, { method: "DELETE" });
      toast("Project deleted", "success");
      onDeleted();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <Card className="min-w-0">
      <div className="grid gap-3 border-b border-white/[0.06] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="violet">{film.genre}</Badge>
          <Badge>{FORMAT_LABEL[film.format]} · {FORMAT_HINT[film.format]}</Badge>
          {film.review && <Badge tone="gold">Review {avg(film)}/10</Badge>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={remove}><Trash2 className="h-3.5 w-3.5" /> {confirmDel ? "Confirm delete" : "Delete"}</Button>
        </div>
        <Field label="Title">
          <Select value={film.title} onChange={(e) => patch({ title: e.target.value }, "Title chosen")} className="text-lg font-semibold">
            {[film.title, ...film.titles.filter((t) => t !== film.title)].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Logline">
          <Textarea rows={2} value={logline} onChange={(e) => setLogline(e.target.value)} onBlur={() => logline.trim() && logline !== film.logline && patch({ logline }, "Logline saved")} />
        </Field>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("focus-ring flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]", tab === t.id ? "bg-white/[0.08] text-white" : "text-white/55 hover:text-white")}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === "story" && <StoryTab film={film} />}
        {tab === "characters" && <CharactersTab film={film} />}
        {tab === "world" && <WorldTab film={film} />}
        {tab === "script" && <ScriptTab film={film} busy={busy} act={act} />}
        {tab === "review" && <ReviewTab film={film} busy={busy} act={act} />}
        {tab === "promote" && <PromoteTab film={film} busy={busy} act={act} />}
      </div>
    </Card>
  );
}

type Act = (key: string, b: Record<string, unknown>, ok?: string) => Promise<FilmProject | undefined>;

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</p>
      <div className="text-[14px] leading-relaxed text-white/80">{children}</div>
    </div>
  );
}

function StoryTab({ film }: { film: FilmProject }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Block label="Theme">{film.theme}</Block>
        <Block label="Dramatic question">{film.dramaticQuestion}</Block>
      </div>
      {film.tone && <Block label="Tone">{film.tone}</Block>}
      <div className="grid gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Structure</p>
        {film.structure.map((b, i) => (
          <div key={i} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
            <p className="text-[13px] font-medium text-mint-300">{b.name}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-white/75">{b.summary}</p>
          </div>
        ))}
      </div>
      {!!film.episodes?.length && (
        <Block label="Season arc">
          <ol className="list-decimal space-y-1 pl-5">{film.episodes.map((e, i) => <li key={i}>{e}</li>)}</ol>
        </Block>
      )}
    </div>
  );
}

function CharactersTab({ film }: { film: FilmProject }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {film.characters.map((c) => (
        <div key={c.name} className="grid content-start gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
          <div>
            <p className="text-base font-semibold text-white">{c.name}</p>
            <p className="text-[13px] text-white/55">{c.role}</p>
          </div>
          <Block label="Look">{c.look}</Block>
          <Block label="Backstory">{c.backstory}</Block>
          <div className="grid gap-3 sm:grid-cols-2">
            <Block label="Wound">{c.wound}</Block>
            <Block label="Flaw">{c.flaw}</Block>
            <Block label="Wants">{c.want}</Block>
            <Block label="Needs">{c.need}</Block>
          </div>
          <Block label="Arc">{c.arc}</Block>
          <Block label="Voice">{c.voice}</Block>
          <Block label="Relationships">{c.relationships}</Block>
        </div>
      ))}
    </div>
  );
}

function WorldTab({ film }: { film: FilmProject }) {
  const w = film.world;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Block label="Setting">{w.setting}</Block>
      <Block label="Era">{w.era}</Block>
      <Block label="Rules of this world">{w.rules}</Block>
      <Block label="Look (cinematography)">{w.look}</Block>
      <Block label="Sound and score">{w.sound}</Block>
    </div>
  );
}

function ScriptTab({ film, busy, act }: { film: FilmProject; busy: string | null; act: Act }) {
  const toast = useApp((s) => s.toast);
  const written = Object.keys(film.pages).length;
  const firstUnwritten = film.scenes.find((s) => !film.pages[String(s.number)])?.number;
  async function copyAll() {
    const text = [`${film.title.toUpperCase()}`, "", ...film.scenes.filter((s) => film.pages[String(s.number)]).map((s) => film.pages[String(s.number)])].join("\n\n");
    await copyToClipboard(text);
    toast("Screenplay copied", "success");
  }
  const write = (from: number) => act(`pages${from}`, { action: "pages", from, to: from + 3 }, "Pages written");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-white/60">{written} of {film.scenes.length} scenes written</span>
        {firstUnwritten && (
          <Button size="sm" variant="primary" className="ml-auto" loading={busy === `pages${firstUnwritten}`} onClick={() => write(firstUnwritten)}>
            <PenLine className="h-3.5 w-3.5" /> Write the next scenes · up to {CREDIT_COST.filmPage * 4} credits
          </Button>
        )}
        {written > 0 && <Button size="sm" variant="secondary" onClick={copyAll}><Copy className="h-3.5 w-3.5" /> Copy screenplay</Button>}
      </div>
      {film.scenes.map((s) => {
        const page = film.pages[String(s.number)];
        return (
          <div key={s.number} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
            <div className="flex flex-wrap items-start gap-2">
              <p className="font-mono text-[13px] font-semibold text-white">{s.number}. {s.heading}</p>
              {!page && (
                <Button size="sm" variant="ghost" className="ml-auto" loading={busy === `pages${s.number}`} onClick={() => write(s.number)}>Write from here</Button>
              )}
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-white/75">{s.summary}</p>
            <div className="mt-2 grid gap-2 text-[12.5px] text-white/55 sm:grid-cols-3">
              <p><span className="text-white/75">Purpose:</span> {s.purpose}</p>
              <p><span className="text-white/75">Conflict:</span> {s.conflict}</p>
              <p><span className="text-white/75">Turn:</span> {s.turn}</p>
            </div>
            {page && <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-ink-900/80 p-4 font-mono text-[12.5px] leading-relaxed text-white/85 ring-1 ring-white/[0.06]">{page}</pre>}
          </div>
        );
      })}
    </div>
  );
}

function ReviewTab({ film, busy, act }: { film: FilmProject; busy: string | null; act: Act }) {
  const [notes, setNotes] = useState("");
  const r = film.review;
  const revise = (n: string) => act("revise", { action: "revise", notes: n }, "Revised — the outline and characters are updated").then((f) => f && setNotes(""));
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] leading-relaxed text-white/60">An honest read against what script readers, festival programmers and awards voters look for. Scores are tough on purpose: a 10 is rare.</p>
        <Button variant="primary" size="sm" className="ml-auto" loading={busy === "review"} onClick={() => act("review", { action: "review" }, "Review ready")}>
          <Award className="h-3.5 w-3.5" /> {r ? "Review again" : "Get the review"} · {CREDIT_COST.filmReview} credits
        </Button>
      </div>
      {r && (
        <>
          <p className="rounded-xl bg-gold-400/[0.06] p-3 text-[14px] text-gold-300 ring-1 ring-gold-400/20">{r.verdict}</p>
          <div className="grid gap-2.5">
            {r.scores.map((s) => (
              <div key={s.area} className="grid gap-1">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-white/85">{s.area}</span>
                  <span className={cn("font-mono", s.score >= 8 ? "text-mint-300" : s.score >= 6 ? "text-gold-300" : "text-red-300")}>{s.score}/10</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={cn("h-full rounded-full", s.score >= 8 ? "bg-mint-400" : s.score >= 6 ? "bg-gold-400" : "bg-red-400")} style={{ width: `${s.score * 10}%` }} />
                </div>
                <p className="text-[12.5px] text-white/55">{s.note}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Block label="Strengths"><ul className="list-disc space-y-1 pl-5">{r.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></Block>
            <Block label="Where it could compete"><ul className="list-disc space-y-1 pl-5">{r.fit.map((x, i) => <li key={i}>{x}</li>)}</ul></Block>
          </div>
          <Block label="Fixes, biggest impact first"><ol className="list-decimal space-y-1 pl-5">{r.fixes.map((x, i) => <li key={i}>{x}</li>)}</ol></Block>
          <Button variant="gold" className="w-fit" loading={busy === "revise"} onClick={() => revise(r.fixes.join("\n"))}>
            <Sparkles className="h-4 w-4" /> Revise with these fixes · {devCost(film.format)} credits
          </Button>
        </>
      )}
      <Field label="Your own notes" hint="The room revises the story, characters and outline">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Make the mother the antagonist. Set it in Houston. The ending should be bittersweet, not happy." />
      </Field>
      <Button variant="secondary" className="w-fit" loading={busy === "revise"} disabled={notes.trim().length < 5} onClick={() => revise(notes)}>
        <PenLine className="h-4 w-4" /> Revise with my notes · {devCost(film.format)} credits
      </Button>
      {!!film.notes.length && <p className="text-[12px] text-white/40">Revised {film.notes.length} time{film.notes.length === 1 ? "" : "s"}. Pages for scenes whose outline changed are cleared so they can be rewritten.</p>}
    </div>
  );
}

function PromoteTab({ film, busy, act }: { film: FilmProject; busy: string | null; act: Act }) {
  const { toast, refresh } = useApp();
  const router = useRouter();
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "facebook", "tiktok"]);
  const [posting, setPosting] = useState(false);
  const p = film.promo;
  const copy = async (t: string) => {
    await copyToClipboard(t);
    toast("Copied", "success");
  };
  function makeMovie() {
    try {
      sessionStorage.setItem(FILM_HANDOFF, JSON.stringify({ brief: briefFor(film) }));
    } catch {
      /* storage unavailable */
    }
    router.push("/movies");
  }
  async function promoPosts() {
    setPosting(true);
    try {
      const r = await api<{ posts: unknown[] }>("/api/films", { body: { id: film.id, action: "promoPosts", platforms } });
      toast(`${r.posts.length} promotion posts saved as drafts in the Content Studio`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPosting(false);
    }
  }
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 rounded-xl bg-mint-400/[0.05] p-4 ring-1 ring-mint-400/20">
        <p className="flex items-center gap-2 text-sm font-medium text-white"><Clapperboard className="h-4 w-4 text-mint-300" /> Make it</p>
        <p className="text-[13px] leading-relaxed text-white/65">Sends the story and cast to Movie Studio. Create each character's portrait there (from a photo or their look below) so they stay the same in every scene.</p>
        <Button variant="primary" className="w-fit" onClick={makeMovie}>Open in Movie Studio</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-white/60">Tagline, synopsis, poster art, trailer beats and a spotlight post for every character.</p>
        <Button size="sm" variant="primary" className="ml-auto" loading={busy === "promo"} onClick={() => act("promo", { action: "promo" }, "Promotion kit ready")}>
          <Megaphone className="h-3.5 w-3.5" /> {p ? "Make a new kit" : "Make the promotion kit"} · {CREDIT_COST.filmPromo} credits
        </Button>
      </div>
      {p && (
        <>
          <div className="rounded-xl bg-white/[0.03] p-5 text-center ring-1 ring-white/[0.07]">
            <p className="text-xl font-semibold tracking-tight text-white">{film.title}</p>
            <p className="mt-1 text-[15px] italic text-gold-300">{p.tagline}</p>
          </div>
          <Copyable label="Synopsis" text={p.synopsis} onCopy={copy} />
          <Copyable label="Poster art prompt" text={p.posterPrompt} onCopy={copy} />
          <Block label="Trailer (60 seconds)"><ol className="list-decimal space-y-1 pl-5">{p.trailer.map((x, i) => <li key={i}>{x}</li>)}</ol></Block>
          <div className="grid gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Character spotlights</p>
            {p.characterSpotlights.map((c) => <Copyable key={c.name} label={c.name} text={c.caption} onCopy={copy} />)}
          </div>
          <Copyable label="Behind the story (pinned post)" text={p.behindTheStory} onCopy={copy} />
          <p className="text-[13px] text-violet-300">{p.hashtags.map((h) => `#${h}`).join(" ")}</p>
          <div className="grid gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
            <p className="text-sm font-medium text-white">Promotion posts</p>
            <div className="flex flex-wrap gap-2">
              {PROMO_PLATFORMS.map((pl) => (
                <label key={pl} className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] ring-1", platforms.includes(pl) ? "bg-white/[0.07] text-white ring-mint-400/30" : "text-white/55 ring-white/10")}>
                  <input type="checkbox" className="accent-mint-400" checked={platforms.includes(pl)} onChange={(e) => setPlatforms((v) => (e.target.checked ? [...v, pl] : v.filter((x) => x !== pl)))} />
                  {PLATFORM_SPECS[pl].name}
                </label>
              ))}
            </div>
            <Button variant="secondary" className="w-fit" loading={posting} disabled={!platforms.length} onClick={promoPosts}>
              Write {platforms.length} post{platforms.length === 1 ? "" : "s"} as drafts · {CREDIT_COST.repurposePerPlatform * platforms.length} credits
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Copyable({ label, text, onCopy }: { label: string; text: string; onCopy: (t: string) => void }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</p>
        <button className="focus-ring rounded-md p-1 text-white/45 hover:text-white" onClick={() => onCopy(text)} aria-label={`Copy ${label}`}><Copy className="h-3.5 w-3.5" /></button>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-white/80">{text}</p>
    </div>
  );
}

/** Same shape as the server's movieBrief: the story and cast in order, for Movie Studio. */
function briefFor(f: FilmProject) {
  return `"${f.title}" — ${f.logline}
Theme: ${f.theme}
World: ${f.world.setting}. ${f.world.look}
Cast: ${f.characters.map((c) => `${c.name} (${c.role}; ${c.look})`).join("; ")}
Story, in order:
${f.scenes.map((s) => `${s.number}. ${s.summary}`).join("\n")}`.slice(0, 11_500);
}
