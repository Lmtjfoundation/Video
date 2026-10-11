"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, Clock, GripVertical, Sparkles, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, fmtTime } from "@/lib/client";
import { addDays, localParts, zonedToUtc } from "@/lib/time";
import type { Post } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { cn, usd } from "@/lib/utils";
import { Badge, Button, Card, Field, Input, PageHeader, PlatformChip, Textarea } from "@/components/ui";
import { PostCard } from "@/components/post-card";

const SHOWN = ["scheduled", "pending_review", "rejected", "published", "copy_ready", "failed", "publishing"];
const MOVABLE = ["scheduled", "pending_review"];

export default function CalendarPage() {
  const { status, toast, refresh } = useApp();
  const settings = status?.settings;
  const tz = settings?.timezone ?? "UTC";
  const [offset, setOffset] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Post | null>(null);
  const [fill, setFill] = useState<{ day: number; total: number; created: number } | null>(null);
  const [topic, setTopic] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [planning, setPlanning] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const today = localParts(new Date(), tz).date;
  const start = addDays(today, offset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);

  const load = useCallback(async () => {
    try {
      setPosts((await api<Post[]>("/api/posts")).filter((p) => p.scheduledAt && SHOWN.includes(p.status)));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts) {
      const d = localParts(new Date(p.scheduledAt!), tz).date;
      m.set(d, [...(m.get(d) ?? []), p]);
    }
    m.forEach((list) => list.sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!)));
    return m;
  }, [posts, tz]);

  const weekPosts = days.flatMap((d) => byDay.get(d) ?? []);
  const weekLow = weekPosts.reduce((s, p) => s + p.revenue.low, 0);
  const weekHigh = weekPosts.reduce((s, p) => s + p.revenue.high, 0);

  async function move(id: string, date: string) {
    const p = posts.find((x) => x.id === id);
    if (!p || !MOVABLE.includes(p.status)) return;
    const time = localParts(new Date(p.scheduledAt!), tz).time;
    if (zonedToUtc(date, time, tz).getTime() < Date.now()) return toast("Can't move a post into the past.", "error");
    // Optimistic update
    setPosts((list) => list.map((x) => (x.id === id ? { ...x, scheduledAt: zonedToUtc(date, time, tz).toISOString() } : x)));
    try {
      const updated = await api<Post>("/api/posts", { method: "PATCH", body: { id, moveToDate: date } });
      setPosts((list) => list.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      toast((e as Error).message, "error");
      load();
    }
  }

  async function fillWeek() {
    if (!settings) return;
    const targets = days.filter((d) => d >= today);
    setFill({ day: 0, total: targets.length, created: 0 });
    let created = 0;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      setFill({ day: i, total: targets.length, created });
      try {
        const r = await api<{ created: number; errors: string[]; pendingReview?: boolean }>("/api/schedule/fill", { body: { date: targets[i], topic: topic || undefined } });
        if (r.pendingReview && i === 0 && r.created) toast("Your posts go to admin review before they publish.", "info");
        created += r.created;
        errors.push(...r.errors);
        await load();
        // AI writing is down (no credits, key or workspace problem): stop instead of retrying every day.
        if (!r.created && r.errors.some((m) => /temporarily unavailable|out of credits|Claude|workspace/i.test(m))) break;
      } catch (e) {
        errors.push((e as Error).message);
        if (/ANTHROPIC_API_KEY|platform|credit|temporarily unavailable|Claude|workspace/i.test((e as Error).message)) break;
      }
    }
    setFill(null);
    refresh();
    if (errors.length) toast(`${created} posts scheduled. ${errors[0]}`, created ? "info" : "error");
    else toast(created ? `${created} posts written & scheduled` : "Week already full — nothing to add", "success");
  }

  async function plan() {
    setPlanning(true);
    try {
      const r = await api<{ rationale: string }>("/api/schedule/plan", { body: { notes: planNotes } });
      toast("AI posting plan applied", "success");
      if (r.rationale) toast(r.rationale, "info");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPlanning(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`Drag scheduled posts between days. Times shown in ${tz}.`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowTools((v) => !v)}>
              <Clock className="h-4 w-4" /> Posting times
            </Button>
            <Button variant="gold" size="lg" onClick={fillWeek} loading={!!fill} disabled={!settings}>
              <CircleDollarSign className="h-4 w-4" /> Fill my week with max-money content
            </Button>
          </>
        }
      />

      {fill && (
        <Card className="mb-5 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-white/80">
              Writing day {fill.day + 1} of {fill.total}… <span className="text-white/45">({fill.created} scheduled so far)</span>
            </span>
            <Sparkles className="h-4 w-4 animate-pulse text-gold-300" />
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-gold-400 transition-all duration-500" style={{ width: `${((fill.day + 0.5) / fill.total) * 100}%` }} />
          </div>
        </Card>
      )}

      {showTools && settings && (
        <Card className="mb-5 grid gap-5 p-5 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-semibold text-white">Current slots · {settings.postsPerDay}/day</p>
            <div className="grid gap-2">
              {PLATFORMS.filter((p) => settings.platforms[p]).map((p) => (
                <div key={p} className="flex items-center gap-3">
                  <PlatformChip platform={p} />
                  <div className="flex flex-wrap gap-1.5">
                    {settings.slots[p].slice(0, settings.postsPerDay).map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-white/40">Defaults are common starting points, not guarantees. Edit them in Settings, or let the AI propose a plan.</p>
          </div>
          <div className="grid gap-3">
            <Field label="Audience notes for the AI plan" hint="optional">
              <Textarea value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} placeholder="e.g. mostly US East Coast professionals, active before work and late evening" className="min-h-[70px]" />
            </Field>
            <Field label="Theme for this week's fill" hint="optional">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI tools that replace a $50/hr freelancer" />
            </Field>
            <Button onClick={plan} loading={planning}>
              <Sparkles className="h-4 w-4" /> Generate AI posting plan
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={offset === 0 ? "secondary" : "ghost"} onClick={() => setOffset(0)}>
          This week
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setOffset((o) => o + 1)} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm text-white/60">
          {start} → {days[6]}
        </span>
        <span className="ml-auto text-sm text-white/50">
          {weekPosts.length} posts · est. <span className="text-mint-300">{usd(weekLow)}–{usd(weekHigh)}</span>
        </span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[980px] grid-cols-7 gap-3">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(d + "T12:00:00Z"));
            const past = d < today;
            return (
              <div
                key={d}
                onDragOver={(e) => {
                  if (!past) {
                    e.preventDefault();
                    setOverDay(d);
                  }
                }}
                onDragLeave={() => setOverDay((o) => (o === d ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverDay(null);
                  if (dragId) move(dragId, d);
                  setDragId(null);
                }}
                className={cn(
                  "glass flex min-h-[460px] flex-col p-2.5 transition-all",
                  d === today && "border-mint-400/30",
                  overDay === d && "border-mint-400/60 bg-mint-400/[0.05] shadow-glow",
                  past && "opacity-60",
                )}
              >
                <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                  <span className={cn("text-[13px] font-semibold", d === today ? "text-mint-300" : "text-white/80")}>{label}</span>
                  <span className="text-[11px] text-white/35">{list.length}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      draggable={MOVABLE.includes(p.status)}
                      onDragStart={(e) => {
                        setDragId(p.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setSelected(p)}
                      className={cn(
                        "focus-ring group rounded-xl border border-white/[0.06] bg-ink-900/70 p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-white/15",
                        MOVABLE.includes(p.status) && "cursor-grab active:cursor-grabbing",
                        p.status === "pending_review" && "border-gold-400/30 border-dashed",
                        dragId === p.id && "opacity-40",
                        p.status === "published" && "border-mint-400/20",
                        p.status === "failed" && "border-red-400/30",
                        p.status === "copy_ready" && "border-gold-400/25",
                      )}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <PlatformChip platform={p.platform} className="h-5 text-[10px]" />
                        <span className="text-[11px] tabular-nums text-white/55">{fmtTime(p.scheduledAt, tz)}</span>
                        <span className={cn("ml-auto text-[11px] font-semibold tabular-nums", p.moneyScore >= 75 ? "text-mint-300" : p.moneyScore >= 50 ? "text-gold-300" : "text-red-300")}>{p.moneyScore}</span>
                        {MOVABLE.includes(p.status) && <GripVertical className="h-3 w-3 text-white/20 group-hover:text-white/50" />}
                      </div>
                      <p className="line-clamp-3 text-[12.5px] leading-snug text-white/85">{p.hook}</p>
                      {p.status !== "scheduled" && <p className="mt-1.5 text-[10px] uppercase tracking-wider text-white/40">{p.status.replace("_", " ")}</p>}
                    </button>
                  ))}
                  {!list.length && !past && (
                    <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-white/[0.06] text-[11px] text-white/25">Drop here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-white/40">
        {PLATFORMS.map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <PlatformChip platform={p} className="h-5 text-[10px]" /> {PLATFORM_SPECS[p].name}
          </span>
        ))}
      </div>

      {selected && settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            <button className="focus-ring absolute right-3 top-3 z-10 rounded-lg p-1.5 text-white/50 hover:text-white" onClick={() => setSelected(null)} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
            <PostCard
              post={selected}
              settings={settings}
              onChange={(p) => {
                if (!p) {
                  setPosts((l) => l.filter((x) => x.id !== selected.id));
                  setSelected(null);
                } else {
                  setSelected(p);
                  setPosts((l) => (SHOWN.includes(p.status) && p.scheduledAt ? l.map((x) => (x.id === p.id ? p : x)) : l.filter((x) => x.id !== p.id)));
                }
                refresh();
              }}
            />
          </div>
        </div>
      )}

      {!posts.length && !fill && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-white/40">
          <CalendarDays className="h-4 w-4" /> Empty calendar — “Fill my week” writes and schedules {settings?.postsPerDay ?? 3} posts/day for each enabled platform.
        </p>
      )}
    </>
  );
}
