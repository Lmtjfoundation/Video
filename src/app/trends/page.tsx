"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Clapperboard, ExternalLink, Flame, PenLine, Play, RefreshCw, Rss, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { GENRES, TIER_LABEL, type FeedTier } from "@/lib/genres";
import { PLATFORMS, type Platform, type Post, type Settings, type VideoPlan } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { CREDIT_COST } from "@/lib/plans";
import { lengthAllowed, videoCredits, VIDEO_LENGTHS } from "@/lib/video-spec";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Switch } from "@/components/ui";

interface Story {
  id: string;
  genre: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  tier: FeedTier;
  publishedAt: string;
  coverage: { source: string; link: string }[];
  heat: number;
}
interface FeedRow {
  id: string;
  name: string;
  tier: FeedTier;
  health: { ok: boolean; at: string; items: number; error?: string } | null;
}
interface AutopilotView {
  trendAutopilot: Settings["trendAutopilot"];
  genres: string[];
  faceless: boolean;
  autopilot: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default function TrendsPage() {
  const { status, toast, refresh } = useApp();
  const [genre, setGenre] = useState("trending");
  const [data, setData] = useState<{ stories: Story[]; fetchedAt: string | null; feeds: FeedRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ap, setAp] = useState<AutopilotView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [length, setLength] = useState<VideoPlan["length"]>("s90");
  const [showSources, setShowSources] = useState(false);
  const isAdmin = status?.me.user.role === "admin";

  const load = useCallback(
    async (g: string, refreshFeeds = false) => {
      setLoading(true);
      try {
        setData(await api(`/api/trends?genre=${g}${refreshFeeds ? "&refresh=1" : ""}`));
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );
  useEffect(() => {
    load(genre);
  }, [genre, load]);
  useEffect(() => {
    api<AutopilotView>("/api/trends/autopilot").then(setAp).catch(() => {});
  }, []);
  useEffect(() => {
    if (!lengthAllowed(length, platform)) setLength("s90");
  }, [platform, length]);

  async function saveAp(patch: { trendAutopilot?: Partial<Settings["trendAutopilot"]>; genres?: string[]; faceless?: boolean }) {
    try {
      setAp(await api<AutopilotView>("/api/trends/autopilot", { method: "PUT", body: patch }));
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function runNow() {
    setBusy("run");
    try {
      const r = await api<AutopilotView & { result: { ran: boolean; created?: number; reason?: string } }>("/api/trends/autopilot", { method: "POST" });
      setAp(r);
      toast(r.lastResult ?? (r.result.ran ? `Wrote ${r.result.created} pieces` : r.result.reason ?? "Done"), r.result.created ? "success" : "info");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function make(story: Story | null, kind: "text" | "video") {
    const key = `${story?.id ?? "pick"}-${kind}`;
    setBusy(key);
    try {
      const posts = await api<Post[]>("/api/trends/create", { body: { genre, storyId: story?.id, platform, kind, length, faceless: ap?.faceless ?? true } });
      toast(`${kind === "video" ? "Video plan" : "Post"} ready: “${posts[0]?.hook ?? ""}”. It's in Content Studio.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const g = GENRES.find((x) => x.id === genre)!;
  const ta = ap?.trendAutopilot;
  const kindForPlatform: "text" | "video" = ["tiktok", "youtube", "instagram"].includes(platform) ? "video" : "text";

  return (
    <>
      <PageHeader title="Trend Radar" subtitle="Live stories from established newsrooms, refreshed every 30 minutes. Turn any of them into a post or a faceless video, or let Trend Autopilot do it for you." />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="xl:order-2">
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-mint-300" /> Trend Autopilot</span>}
              subtitle={ta?.enabled ? <span className="text-mint-300">On · fills the next 6 hours every 2 hours</span> : "Off"}
              action={ap ? <Switch checked={!!ta?.enabled} onChange={(v) => saveAp({ trendAutopilot: { enabled: v } })} label="Trend Autopilot" /> : undefined}
            />
            {ap && ta && (
              <div className="grid gap-3 p-5 text-[13px]">
                <Field label="What it does">
                  <Select value={ta.mode} onChange={(e) => saveAp({ trendAutopilot: { mode: e.target.value as "schedule" | "drafts" } })}>
                    <option value="schedule">Fill open calendar slots (posts go out on schedule)</option>
                    <option value="drafts">Write drafts only (I review and schedule)</option>
                  </Select>
                </Field>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/75">Video plans for TikTok, YouTube, Instagram, Facebook</span>
                  <Switch checked={ta.videos} onChange={(v) => saveAp({ trendAutopilot: { videos: v } })} label="Videos" />
                </div>
                {ta.videos && (
                  <>
                    <Field label="Video length">
                      <Select value={ta.videoLength} onChange={(e) => saveAp({ trendAutopilot: { videoLength: e.target.value as VideoPlan["length"] } })}>
                        {Object.entries(VIDEO_LENGTHS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </Select>
                    </Field>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white/75">Render them to MP4 automatically</span>
                      <Switch checked={ta.autoRender} onChange={(v) => saveAp({ trendAutopilot: { autoRender: v } })} label="Auto-render" />
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/75">Faceless videos</span>
                  <Switch checked={ap.faceless} onChange={(v) => saveAp({ faceless: v })} label="Faceless" />
                </div>
                <div>
                  <span className="mb-1.5 block text-white/75">Genres it covers</span>
                  <div className="flex flex-wrap gap-1.5">
                    {GENRES.map((x) => {
                      const on = ap.genres.includes(x.id);
                      return (
                        <button
                          key={x.id}
                          onClick={() => saveAp({ genres: on ? ap.genres.filter((y) => y !== x.id) : [...ap.genres, x.id] })}
                          className={cn("focus-ring rounded-lg px-2 py-1 text-[12px] ring-1", on ? "bg-mint-400/15 text-mint-200 ring-mint-400/35" : "bg-white/[0.03] text-white/50 ring-white/10 hover:text-white")}
                        >
                          {x.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {ta.mode === "schedule" && !ap.autopilot && (
                  <p className="rounded-lg bg-gold-400/10 px-3 py-2 text-[12px] text-gold-200 ring-1 ring-gold-400/25">
                    Publishing autopilot is off, so scheduled posts will wait. Turn on Autopilot in the <Link href="/" className="underline">Command Center</Link> to post automatically.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="primary" loading={busy === "run"} onClick={runNow}><Play className="h-3.5 w-3.5" /> Run now</Button>
                  {ap.lastRunAt && <span className="text-[12px] text-white/45">Last run {ago(ap.lastRunAt)}</span>}
                </div>
                {ap.lastResult && <p className="text-[12px] text-white/50">{ap.lastResult}</p>}
              </div>
            )}
          </Card>
        </div>
        <div className="min-w-0 xl:order-1">
          <Card className="mb-5 p-5 text-[13px] leading-relaxed text-white/65">
          <p className="flex items-center gap-2 font-medium text-white"><ShieldCheck className="h-4 w-4 text-mint-300" /> Built to go viral, and built to be right</p>
          <p className="mt-2">
            Every piece starts from real reporting: wire services, public media, national outlets and, for Black America, the Black press (Capital B, TheGrio, The Root, Word In Black, Black Enterprise, Essence, Andscape, NewsOne, AFRO, BlackPressUSA) plus AP, NPR and PBS. The writer only uses what's in the reporting, credits the outlet, and on the built-in AI it checks details against live coverage.
          </p>
          <p className="mt-2">
            Each piece gets a 1-second hook, an open question, a mid-video turn, a payoff, and the ranking signals of the platform it's for. On Unlimited, every money lever is applied too. No tool can promise millions of views: these are the ingredients that give a piece its best shot.
          </p>
        </Card>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {GENRES.map((x) => (
          <button
            key={x.id}
            onClick={() => setGenre(x.id)}
            className={cn("focus-ring shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors", genre === x.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
          >
            {x.name}
          </button>
        ))}
      </div>

      <Card className="mb-4 grid gap-3 p-4">
        <div>
          <p className="text-sm font-medium text-white">{g.name}</p>
          <p className="text-[13px] text-white/55">{g.brief}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Make it for" className="w-40">
            <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}
            </Select>
          </Field>
          <Field label="Video length" className="w-56">
            <Select value={length} onChange={(e) => setLength(e.target.value as VideoPlan["length"])}>
              {Object.entries(VIDEO_LENGTHS).filter(([k]) => lengthAllowed(k as VideoPlan["length"], platform)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Button size="sm" loading={loading} onClick={() => load(genre, true)}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </Card>

      {!g.feeds.length ? (
        <Card className="grid gap-3 p-6">
          <p className="text-sm text-white/70">{g.name} is an evergreen genre: it uses documented stories and ties them to today's date or headlines when the link is real.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === "pick-text"} onClick={() => make(null, "text")}><PenLine className="h-4 w-4" /> Write a post · {CREDIT_COST.post} credit</Button>
            <Button loading={busy === "pick-video"} onClick={() => make(null, "video")}><Clapperboard className="h-4 w-4" /> Make a video · {videoCredits(length, "plan")} credits</Button>
          </div>
        </Card>
      ) : !data ? (
        <div className="glass h-96 animate-pulse" />
      ) : !data.stories.length ? (
        <Card className="p-6 text-sm text-white/60">No fresh stories came through for {g.name} right now. Try Refresh in a few minutes, or check the sources below.</Card>
      ) : (
        <div className="grid gap-3">
          {data.stories.map((st) => (
            <Card key={st.id} className="grid gap-3 p-4 md:grid-cols-[64px_1fr_auto] md:items-center">
              <div className="flex items-center gap-2 md:flex-col md:gap-1">
                <Flame className={cn("h-5 w-5", st.heat >= 70 ? "text-red-400" : st.heat >= 45 ? "text-gold-300" : "text-white/35")} />
                <span className="text-[12px] tabular-nums text-white/60">{st.heat}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-medium leading-snug text-white">{st.title}</p>
                {st.summary && <p className="mt-1 line-clamp-2 text-[13px] text-white/55">{st.summary}</p>}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/45">
                  <a href={st.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-mint-300 hover:underline">{st.source} <ExternalLink className="h-3 w-3" /></a>
                  <span>· {ago(st.publishedAt)}</span>
                  <Badge tone={st.tier === "black_press" ? "violet" : "neutral"}>{TIER_LABEL[st.tier]}</Badge>
                  {st.coverage.length > 1 && <span>· also {st.coverage.slice(1, 4).map((c) => c.source).join(", ")}{st.coverage.length > 4 ? ` +${st.coverage.length - 4}` : ""}</span>}
                </p>
              </div>
              <div className="flex gap-2 md:flex-col">
                <Button size="sm" variant={kindForPlatform === "text" ? "primary" : "secondary"} loading={busy === `${st.id}-text`} onClick={() => make(st, "text")}><PenLine className="h-3.5 w-3.5" /> Post</Button>
                <Button size="sm" variant={kindForPlatform === "video" ? "primary" : "secondary"} loading={busy === `${st.id}-video`} onClick={() => make(st, "video")}><Clapperboard className="h-3.5 w-3.5" /> Video</Button>
              </div>
            </Card>
          ))}
          <p className="text-[12px] text-white/40">Heat combines how fresh a story is and how many newsrooms are covering it. It ranks stories; it doesn't predict views. A post from a story costs {CREDIT_COST.post + CREDIT_COST.liveCheck} credits; a video plan at this length costs {videoCredits(length, "plan") + CREDIT_COST.liveCheck} (each includes the live fact-check). Free during a trial's daily allowance, and on your own AI key.</p>
        </div>
      )}

      {data && data.feeds.length > 0 && (
        <div className="mt-6">
          <button className="focus-ring flex items-center gap-2 text-sm text-white/55 hover:text-white" onClick={() => setShowSources((v) => !v)}>
            <Rss className="h-4 w-4" /> Sources for {g.name} ({data.feeds.filter((f) => f.health?.ok).length}/{data.feeds.length} working){data.fetchedAt ? ` · checked ${ago(data.fetchedAt)}` : ""}
          </button>
          {showSources && (
            <Card className="mt-3 divide-y divide-white/[0.05]">
              {data.feeds.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                  <span className={cn("h-2 w-2 rounded-full", f.health == null ? "bg-white/25" : f.health.ok ? "bg-mint-400" : "bg-red-400")} />
                  <span className="text-white/80">{f.name}</span>
                  <Badge>{TIER_LABEL[f.tier]}</Badge>
                  <span className="ml-auto text-[12px] text-white/40">{f.health == null ? "not checked yet" : f.health.ok ? `${f.health.items} items` : f.health.error ?? "not working"}</span>
                </div>
              ))}
              {isAdmin && <CustomFeeds genre={genre} onSaved={() => load(genre, true)} />}
            </Card>
          )}
        </div>
      )}
        </div>
      </div>
    </>
  );
}

/** Admin: add a newsroom's RSS feed to a genre (or replace one whose address changed). */
function CustomFeeds({ genre, onSaved }: { genre: string; onSaved: () => void }) {
  const toast = useApp((x) => x.toast);
  const [all, setAll] = useState<{ genre: string; name: string; url: string; tier: FeedTier }[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState<FeedTier>("national");
  useEffect(() => {
    api<{ genre: string; name: string; url: string; tier: FeedTier }[]>("/api/trends/feeds").then(setAll).catch(() => {});
  }, []);
  async function save(list: typeof all) {
    try {
      setAll(await api("/api/trends/feeds", { method: "PUT", body: { feeds: list } }));
      toast("Sources updated", "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const mine = all.filter((f) => f.genre === genre);
  return (
    <div className="grid gap-2 px-4 py-3">
      <p className="text-[12px] font-medium text-white/70">Admin: add an RSS feed to this genre</p>
      {mine.map((f) => (
        <div key={f.url} className="flex items-center gap-2 text-[12px] text-white/60">
          <span className="truncate">{f.name} · {f.url}</span>
          <button className="ml-auto text-red-300 hover:underline" onClick={() => save(all.filter((x) => x !== f))}>Remove</button>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_140px_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Outlet name" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://outlet.com/feed/" />
        <Select value={tier} onChange={(e) => setTier(e.target.value as FeedTier)}>
          {(Object.keys(TIER_LABEL) as FeedTier[]).map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </Select>
        <Button size="sm" disabled={!url} onClick={() => { save([...all, { genre, name, url, tier }]); setName(""); setUrl(""); }}>Add</Button>
      </div>
    </div>
  );
}
