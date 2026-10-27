"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { api } from "@/lib/client";
import type { Plan } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader } from "./ui";

export interface PlansPayload {
  plans: (Plan & { checkout: { month: boolean; year: boolean }; introReady?: boolean })[];
  credits: { action: string; credits: number; label: string }[];
  payments: boolean;
}

/** Inside the iOS/Android app, purchases are hidden to follow app-store payment rules. */
export const inNativeApp = () =>
  typeof window !== "undefined" &&
  (!!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() || /GhostPostApp/.test(navigator.userAgent));

const COMPETITORS: [string, number][] = [
  ["OpusClip Starter", 15],
  ["AutoShorts Starter", 19],
  ["Later Starter", 25],
  ["SocialBee Bootstrap", 29],
  ["AutoShorts Daily", 39],
];

export function PricingTable({
  currentPlan,
  signedIn,
  hasSubscription,
  trialEligible = true,
  initial,
}: {
  currentPlan?: string;
  signedIn: boolean;
  hasSubscription?: boolean;
  /** Whether this account can still start a free trial (visitors who aren't signed in can). */
  trialEligible?: boolean;
  /** Server-rendered plans (public pricing page), so plans show without waiting for JavaScript. */
  initial?: PlansPayload;
}) {
  const [data, setData] = useState<PlansPayload | null>(initial ?? null);
  const [cycle, setCycle] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNative(inNativeApp());
    if (initial) return;
    fetch("/api/plans").then((r) => r.json()).then(setData).catch(() => setError("Couldn't load plans."));
  }, [initial]);

  async function choose(planId: string) {
    if (!signedIn) {
      // Carry the chosen plan through sign-up so checkout opens right after the account is created.
      window.location.href = planId === "free" ? "/signup" : `/signup?plan=${encodeURIComponent(planId)}&interval=${cycle}`;
      return;
    }
    setBusy(planId);
    setError(null);
    try {
      const path = hasSubscription ? "/api/billing/portal" : "/api/billing/checkout";
      const { url } = await api<{ url: string }>(path, { body: { plan: planId, interval: cycle } });
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (!data) return <div className="glass h-96 animate-pulse" />;
  /** Show the trial on plans that have one, to visitors and to accounts that haven't used a trial or subscribed. */
  const offersTrial = (p: PlansPayload["plans"][number]) => !!p.trial && trialEligible && !hasSubscription && currentPlan !== p.id;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10">
          {(["month", "year"] as const).map((c) => (
            <button key={c} onClick={() => setCycle(c)} className={cn("focus-ring rounded-lg px-4 py-1.5 text-sm font-medium", cycle === c ? "bg-white/10 text-white" : "text-white/55")}>
              {c === "month" ? "Monthly" : "Yearly · save ~15%"}
            </button>
          ))}
        </div>
        {native && <p className="text-sm text-white/55">Plans can be changed on the Ghost Post website.</p>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-400/25">{error}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((p) => {
          const price = cycle === "year" ? p.annual : p.monthly;
          const current = currentPlan === p.id;
          return (
            <div key={p.id} className={cn("glass relative flex flex-col gap-4 p-6", p.popular && "border-mint-400/40 shadow-glow", current && "ring-2 ring-gold-400/50")}>
              {p.popular && <span className="absolute -top-3 left-6 rounded-full bg-mint-400 px-2.5 py-1 text-[11px] font-semibold text-ink-950">Most popular</span>}
              <div>
                <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                <p className="mt-1 text-sm text-white/50">{p.blurb}</p>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tabular-nums text-white">${price}</span>
                <span className="text-sm text-white/45">/ month{cycle === "year" && p.monthly ? ", billed yearly" : ""}</span>
              </div>
              {offersTrial(p) && (
                <div className="-mt-2 grid grid-cols-1 gap-1 rounded-xl bg-mint-400/[0.07] p-3 text-[13px] ring-1 ring-mint-400/20">
                  <span className="font-semibold text-mint-200">{p.trial!.days} days free</span>
                  <span className="text-white/65">
                    {cycle === "month" && p.introReady
                      ? <>Then <span className="font-medium text-white">${p.trial!.firstMonth}</span> for your first month, then ${p.monthly}/month.</>
                      : cycle === "month"
                        ? <>Then ${p.monthly}/month.</>
                        : <>Then ${p.annual * 12} for the year.</>}
                  </span>
                  <span className="text-[11.5px] text-white/45">Free AI writing every day of the trial. Card required; cancel before day {p.trial!.days} and you pay nothing.</span>
                </div>
              )}
              <ul className="grid grid-cols-1 flex-1 gap-2 text-sm text-white/75">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-mint-300" /> {h}</li>
                ))}
              </ul>
              {current ? (
                <Button disabled>Current plan</Button>
              ) : p.id === "free" ? (
                signedIn ? (hasSubscription && !native ? <Button loading={busy === "free"} onClick={() => choose("free")}>Manage or cancel</Button> : <Button disabled>Included</Button>) : <Link href="/signup"><Button className="w-full">Start free</Button></Link>
              ) : native ? (
                <Button disabled>Available on the website</Button>
              ) : !data.payments || !p.checkout[cycle] ? (
                <Button disabled title="The admin hasn't connected payments yet">Coming soon</Button>
              ) : (
                <Button variant={p.popular ? "primary" : "secondary"} loading={busy === p.id} onClick={() => choose(p.id)}>
                  {offersTrial(p) ? `Start ${p.trial!.days}-day free trial` : signedIn ? (hasSubscription ? "Change plan" : `Choose ${p.name}`) : `Start with ${p.name}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="What credits buy" subtitle="Credits pay for AI-written content. Posting, scheduling, analytics and safety checks never use credits." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-white/40"><tr><th className="px-5 py-2.5">Action</th><th className="px-5 py-2.5">Credits</th><th className="px-5 py-2.5">Pro covers / month</th></tr></thead>
              <tbody className="divide-y divide-white/[0.05]">
                {data.credits.map((c) => (
                  <tr key={c.action}><td className="px-5 py-2.5 text-white/80">{c.label}</td><td className="px-5 py-2.5 tabular-nums">{c.credits}</td><td className="px-5 py-2.5 tabular-nums text-white/50">{Math.floor((data.plans.find((p) => p.id === "pro")?.credits ?? 1000) / c.credits).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="How the price compares" subtitle="Entry plans of popular tools (2026 list prices). Most cover only scheduling or only video." />
          <div className="grid grid-cols-1 gap-2.5 p-5">
            {[...COMPETITORS, ["Ghost Post Creator", 12] as [string, number], ["Ghost Post Pro", 29] as [string, number]]
              .sort((a, b) => a[1] - b[1])
              .map(([n, pr]) => (
                <div key={n} className="grid grid-cols-[150px_1fr_44px] items-center gap-3 text-sm">
                  <span className={n.startsWith("Ghost Post") ? "font-medium text-white" : "text-white/55"}>{n}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]"><div className={cn("h-full rounded-full", n.startsWith("Ghost Post") ? "bg-gradient-to-r from-mint-400 to-gold-400" : "bg-white/20")} style={{ width: `${(pr / 40) * 100}%` }} /></div>
                  <span className="text-right tabular-nums text-white/80">${pr}</span>
                </div>
              ))}
            <p className="mt-2 text-xs text-white/40">Ghost Post combines niche research, story scripts, video and film making, scheduling for six platforms and reply automation in one plan.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
