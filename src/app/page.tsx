"use client";
import Link from "next/link";
import { TriangleAlert, ArrowRight, Bot, CalendarDays, CircleDollarSign, MessageSquare, Power, Rocket, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useApp } from "@/lib/store";
import { fmtDateTime, timeAgo } from "@/lib/client";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, PlatformChip, ScoreRing, Stat, Switch } from "@/components/ui";
import { cn, usd } from "@/lib/utils";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";

export default function Dashboard() {
  const { status, updateSettings } = useApp();

  if (!status) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="glass h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  const { settings, stats, env, upcoming, logs, credentials, me } = status;
  const isAdmin = me.user.role === "admin";
  const connected = credentials.filter((c) => c.connected).length;
  const setup = isAdmin
    ? [
        { ok: env.llm, label: "Claude API key", hint: "ANTHROPIC_API_KEY in .env.local" },
        { ok: env.encryption, label: "Encryption key", hint: "ENCRYPTION_KEY — run npm run gen:key" },
        { ok: env.appUrl, label: "Public app URL", hint: "APP_URL — needed for linking and uploads" },
        { ok: env.cron, label: "Scheduler secret", hint: "CRON_SECRET + a cron caller (see README)" },
        { ok: env.stripe, label: "Payments", hint: "Stripe keys — see Admin → App settings" },
      ]
    : [
        { ok: connected > 0, label: "Link a social account", hint: "Settings → Accounts" },
        { ok: stats.scheduled + stats.inReview > 0, label: "Schedule your first posts", hint: "Calendar → Fill my week" },
      ];
  const setupDone = setup.every((s) => s.ok);

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle="Your agent's status, money pipeline and latest activity."
        actions={
          <>
            <Link href="/calendar">
              <Button variant="secondary"><CalendarDays className="h-4 w-4" /> Calendar</Button>
            </Link>
            <Link href="/studio">
              <Button variant="primary"><Sparkles className="h-4 w-4" /> Create content</Button>
            </Link>
          </>
        }
      />

      {/* Control panel */}
      <Card className={cn("mb-6 overflow-hidden", settings.killSwitch && "border-red-400/30")}>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-mint-400/[0.06] via-transparent to-violet-500/[0.06]" />
        <div className="relative grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center">
          <div className="grid gap-4 sm:grid-cols-3">
            <Toggle
              icon={<Rocket className="h-4 w-4" />}
              title="Autopilot posting"
              desc="Publishes scheduled posts on time"
              checked={settings.autopilot}
              onChange={(v) => updateSettings({ autopilot: v })}
              disabled={settings.killSwitch}
            />
            <Toggle
              icon={<Bot className="h-4 w-4" />}
              title="Auto-engagement"
              desc={settings.requireReplyApproval ? "Drafts replies for your approval" : "Replies automatically"}
              checked={settings.autoReply}
              onChange={(v) => updateSettings({ autoReply: v })}
              disabled={settings.killSwitch}
            />
            <Toggle
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Approve replies first"
              desc="Recommended while you tune the voice"
              checked={settings.requireReplyApproval}
              onChange={(v) => updateSettings({ requireReplyApproval: v })}
            />
          </div>
          <Button
            variant={settings.killSwitch ? "primary" : "danger"}
            size="lg"
            onClick={() => updateSettings({ killSwitch: !settings.killSwitch })}
            className="md:min-w-[190px]"
          >
            <Power className="h-4 w-4" /> {settings.killSwitch ? "Release kill switch" : "Kill switch"}
          </Button>
        </div>
      </Card>

      {!setupDone && (
        <Card className="mb-6 border-gold-400/20 p-5">
          <div className="mb-3 flex items-center gap-2 text-gold-300">
            <TriangleAlert className="h-4 w-4" />
            <span className="text-sm font-semibold">Finish setup</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {setup.map((s) => (
              <div key={s.label} className={cn("rounded-xl p-3 ring-1", s.ok ? "bg-mint-400/[0.05] ring-mint-400/20" : "bg-white/[0.02] ring-white/10")}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-white">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.ok ? "bg-mint-400" : "bg-white/30")} /> {s.label}
                </div>
                {!s.ok && <p className="mt-1 text-[11px] text-white/45">{s.hint}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Scheduled" value={stats.scheduled} sub={`${stats.drafts} drafts · ${stats.copyReady} copy-ready`} icon={<CalendarDays className="h-4 w-4" />} accent="violet" />
        <Stat label="Published today" value={stats.publishedToday} sub={stats.failed ? `${stats.failed} need attention` : "No failures"} icon={<Send className="h-4 w-4" />} accent={stats.failed ? "red" : "mint"} />
        <Stat
          label="Est. revenue · next 7 days"
          value={<span className="text-gradient">{usd(stats.weekRevenueLow)}–{usd(stats.weekRevenueHigh)}</span>}
          sub={`Avg money score ${stats.avgMoneyScore} · from your inputs`}
          icon={<CircleDollarSign className="h-4 w-4" />}
          accent="gold"
        />
        <Stat
          label="Replies"
          value={stats.pendingReplies}
          sub={`awaiting approval · ${stats.repliesSent} sent${stats.escalated ? ` · ${stats.escalated} escalated` : ""}`}
          icon={<MessageSquare className="h-4 w-4" />}
        />
      </div>

      <Card className="mb-6 grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
        <UsageBar label={`AI credits · ${me.plan.name}`} used={me.plan.credits - me.creditsLeft} total={me.plan.credits} />
        <UsageBar label="Posts this month" used={me.user.usage.posts} total={me.plan.postsPerMonth} />
        <Link href="/plans"><Button size="sm" variant={me.creditsLeft < me.plan.credits * 0.15 ? "gold" : "secondary"}>{me.plan.id === "unlimited" ? "Plan & billing" : "Upgrade"}</Button></Link>
      </Card>
      {(stats.inReview > 0 || stats.rejected > 0) && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="text-white/75">{stats.inReview > 0 && <><b className="text-gold-300">{stats.inReview}</b> post{stats.inReview > 1 ? "s" : ""} waiting for admin approval. </>}{stats.rejected > 0 && <><b className="text-red-300">{stats.rejected}</b> sent back with notes.</>}</span>
          <Link href="/studio"><Button size="sm">Review in Content Studio</Button></Link>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Up next"
            subtitle="The next posts in the queue"
            icon={<CalendarDays className="h-4 w-4" />}
            action={<Link href="/calendar" className="text-xs text-mint-300 hover:underline">Calendar</Link>}
          />
          {upcoming.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                  <ScoreRing score={p.moneyScore} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{p.hook}</p>
                    <p className="mt-0.5 text-xs text-white/45">{fmtDateTime(p.scheduledAt, settings.timezone)}</p>
                  </div>
                  <PlatformChip platform={p.platform} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<CalendarDays className="h-6 w-6" />}
              title="Nothing scheduled"
              body="Fill your week in one click — the agent writes and schedules 3 posts a day per platform."
              action={<Link href="/calendar"><Button variant="primary">Open calendar <ArrowRight className="h-4 w-4" /></Button></Link>}
            />
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Live activity" subtitle="What the agent just did" icon={<Bot className="h-4 w-4" />} action={<Link href="/logs" className="text-xs text-mint-300 hover:underline">All logs</Link>} />
          {logs.length ? (
            <ul className="max-h-[420px] divide-y divide-white/[0.05] overflow-auto">
              {logs.map((l) => (
                <li key={l.id} className="flex gap-3 px-5 py-3">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", l.level === "error" ? "bg-red-400" : l.level === "warn" ? "bg-gold-400" : "bg-mint-400")} />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug text-white/80">{l.message}</p>
                    <p className="mt-0.5 text-[11px] text-white/35">
                      {l.platform ? `${PLATFORM_SPECS[l.platform].name} · ` : ""}
                      {l.kind} · {timeAgo(l.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No activity yet" body="Generate your first post to see the agent at work." />
          )}
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-white/40">
        <Badge tone={env.storage === "supabase" ? "mint" : "neutral"}>Storage: {env.storage}</Badge>
        <Badge tone={connected ? "mint" : "neutral"}>{connected} account{connected === 1 ? "" : "s"} connected</Badge>
        <Badge>{settings.postsPerDay} posts/day/platform</Badge>
        <Badge>{settings.timezone}</Badge>
      </div>
    </>
  );
}

function Toggle({ icon, title, desc, checked, onChange, disabled }: { icon: React.ReactNode; title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.06]">
      <div className="flex gap-3">
        <span className={cn("mt-0.5", checked ? "text-mint-300" : "text-white/40")}>{icon}</span>
        <div>
          <p className="text-[13.5px] font-medium text-white">{title}</p>
          <p className="mt-0.5 text-[12px] text-white/45">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}

function UsageBar({ label, used, total }: { label: string; used: number; total: number | null }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 3;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white/60">{label}</span>
        <span className="tabular-nums text-white">{used.toLocaleString()} / {total === null ? "Unlimited" : total.toLocaleString()}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full", pct > 85 ? "bg-gold-400" : "bg-gradient-to-r from-mint-400 to-gold-400")} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}
