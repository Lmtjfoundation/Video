"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, AudioLines, BookOpen, Video as VideoIcon, BookOpenText, CalendarDays, Clapperboard, Compass, CreditCard, Feather, Film, Flame, Images, LayoutDashboard, Library, Wand2, Workflow, Code2, Lightbulb, ListVideo, LogOut, Menu, Mic, MessageSquare, MessagesSquare, Palette, ScrollText, Settings, Share2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { JobsTray } from "./jobs-tray";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; short: string; icon: typeof Activity; badge?: "pending" | "review"; admin?: boolean };
const NAV: NavItem[] = [
  { href: "/", label: "Command Center", short: "Home", icon: LayoutDashboard },
  { href: "/trends", label: "Trend Radar", short: "Trends", icon: Flame },
  { href: "/platforms", label: "Platforms", short: "Platforms", icon: Share2 },
  { href: "/niche", label: "Niche Lab", short: "Niches", icon: Compass },
  { href: "/stories", label: "Story Studio", short: "Stories", icon: BookOpenText },
  { href: "/studio", label: "Content Studio", short: "Create", icon: Sparkles },
  { href: "/writers", label: "Writers' Room", short: "Writers", icon: Feather },
  { href: "/movies", label: "Movie Studio", short: "Movies", icon: Film },
  { href: "/film-engine", label: "Film Engine", short: "Film", icon: Clapperboard },
  { href: "/director", label: "Director", short: "Director", icon: MessagesSquare },
  { href: "/series", label: "Series Studio", short: "Series", icon: ListVideo },
  { href: "/images", label: "Image Studio", short: "Images", icon: Palette },
  { href: "/create", label: "AI Studio", short: "AI Studio", icon: Wand2 },
  { href: "/story-video", label: "Story to Video", short: "Stories", icon: BookOpen },
  { href: "/voice-lab", label: "Voice Lab", short: "Voices", icon: AudioLines },
  { href: "/voice-lab?tab=record", label: "Record Voice", short: "Record", icon: Mic },
  { href: "/video-tools", label: "Video Tools", short: "Video", icon: VideoIcon },
  { href: "/library", label: "Library", short: "Library", icon: Library },
  { href: "/flows", label: "Flows", short: "Flows", icon: Workflow },
  { href: "/explain", label: "Explain", short: "Explain", icon: Lightbulb },
  { href: "/calendar", label: "Calendar", short: "Calendar", icon: CalendarDays },
  { href: "/media", label: "Media Library", short: "Media", icon: Images },
  { href: "/engage", label: "Engagement", short: "Replies", icon: MessageSquare, badge: "pending" },
  { href: "/logs", label: "Activity Log", short: "Log", icon: ScrollText },
  { href: "/plans", label: "Plans & Billing", short: "Plans", icon: CreditCard },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
  { href: "/developers", label: "Developers", short: "API", icon: Code2 },
  { href: "/admin", label: "Admin", short: "Admin", icon: ShieldCheck, badge: "review", admin: true },
];
/** Bottom bar on phones: the five things people do most. */
const MOBILE_TABS = ["/", "/trends", "/studio", "/calendar", "/engage"];
const BARE_ROUTES = ["/login", "/signup", "/pricing", "/offline", "/terms", "/privacy", "/data-deletion", "/forgot", "/reset", "/restore"];

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid grid-cols-1 h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500 shadow-glow">
        <Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-white">Ghost Post</div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-mint-300/80">Autopilot</div>
        </div>
      )}
    </div>
  );
}

function trialDaysLeft(endsAt: string | null) {
  if (!endsAt) return "ends soon";
  const days = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400_000);
  return days <= 1 ? "last day" : `${days} days`;
}

function AccountCard() {
  const { status, logout } = useApp();
  if (!status) return <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />;
  const { me, settings } = status;
  const meterTotal = Math.max(me.plan.credits, me.creditsLeft, 1);
  const used = meterTotal - me.creditsLeft;
  const state = settings.killSwitch ? ["bg-red-400", "Kill switch on"] : settings.autopilot ? ["bg-mint-400", "Autopilot live"] : ["bg-gold-400", "Manual mode"];
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 text-[12px] text-white/70">
        <span className={cn("h-2 w-2 rounded-full", state[0], settings.autopilot && !settings.killSwitch && "animate-pulseDot")} />
        {state[1]}
      </div>
      <div>
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-white/60">{me.plan.name} plan</span>
          <span className="tabular-nums text-white/80">{me.user.role === "admin" ? "Owner · no credits used" : `${me.creditsLeft.toLocaleString()} credits`}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-gold-400" style={{ width: `${Math.max(2, 100 - (used / meterTotal) * 100)}%` }} />
        </div>
      </div>
      {me.trial?.active && (
        <Link href="/plans" className="rounded-lg bg-mint-400/[0.08] px-2.5 py-1.5 text-[11.5px] leading-snug text-mint-200 ring-1 ring-mint-400/20 hover:bg-mint-400/[0.12]">
          Free trial · {trialDaysLeft(me.trial.endsAt)} left
          <span className="block text-white/55">{me.ownAi ? "Your own AI: no credits used" : `${me.trial.freeLeftToday} free AI credits left today`}</span>
        </Link>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-white/50" title={me.user.email}>{me.user.email}</span>
        <button onClick={logout} className="focus-ring rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white" aria-label="Sign out" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Toaster() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 lg:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            "pointer-events-auto animate-rise cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl",
            t.kind === "error" && "border-red-400/30 bg-red-950/80 text-red-100",
            t.kind === "success" && "border-mint-400/30 bg-ink-850/90 text-white",
            t.kind === "info" && "border-white/10 bg-ink-850/90 text-white/90",
          )}
        >
          {t.kind === "success" && <span className="mr-2 text-mint-300">✓</span>}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { status, refresh } = useApp();
  const bare = BARE_ROUTES.some((r) => path === r || path.startsWith(r + "/"));

  useEffect(() => {
    if (bare) return;
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh, bare]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  if (bare) return <>{children}<Toaster /></>;

  const isAdmin = status?.me.user.role === "admin";
  const items = NAV.filter((n) => !n.admin || isAdmin);
  const pending = (status?.stats.pendingReplies ?? 0) + (status?.stats.escalated ?? 0);
  const badgeFor = (b?: NavItem["badge"]) => (b === "pending" ? pending : 0);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon, badge }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors",
            active(href) ? "bg-white/[0.07] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white",
          )}
        >
          {active(href) && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-mint-400 shadow-glow" />}
          <Icon className={cn("h-[18px] w-[18px]", active(href) ? "text-mint-300" : "text-white/40 group-hover:text-white/70")} />
          {label}
          {badgeFor(badge) > 0 && <span className="ml-auto rounded-full bg-gold-400 px-1.5 text-[11px] font-semibold text-ink-950">{badgeFor(badge)}</span>}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/[0.06] bg-ink-950/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        {nav}
        <div className="mt-auto">
          <AccountCard />
        </div>
      </aside>

      {/* Phone/tablet top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-white/[0.06] bg-ink-950/85 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur-xl lg:hidden">
        <Logo />
        <div className="flex items-center gap-2">
          {status && <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] tabular-nums text-white/70">{status.me.creditsLeft.toLocaleString()} credits</span>}
          <button className="focus-ring rounded-lg p-2 text-white/80" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-30 overflow-y-auto bg-ink-950/95 px-4 pb-28 pt-[calc(env(safe-area-inset-top)+76px)] backdrop-blur-xl lg:hidden">
          {nav}
          <div className="mt-6">
            <AccountCard />
          </div>
        </div>
      )}

      <JobsTray />
      <main className="min-w-0 flex-1 px-4 pb-28 pt-[calc(env(safe-area-inset-top)+84px)] sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>

      {/* Phone bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/[0.07] bg-ink-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
        {MOBILE_TABS.map((href) => {
          const item = NAV.find((n) => n.href === href)!;
          const Icon = item.icon;
          return (
            <Link key={href} href={href} className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium", active(href) ? "text-mint-300" : "text-white/50")}>
              <Icon className="h-5 w-5" />
              {item.short}
              {badgeFor(item.badge) > 0 && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-gold-400" />}
            </Link>
          );
        })}
      </nav>
      <Toaster />
    </div>
  );
}
