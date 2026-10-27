"use client";
import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import type { Me } from "@/lib/store";
import { PACK_DAYS, POOL_PER_USER_DAILY } from "@/lib/vault-core";
import { CREDIT_PACKS } from "@/lib/plans";
import { PricingTable, inNativeApp } from "@/components/pricing";

export default function PlansPage() {
  const { status, toast, refresh } = useApp();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    const trial = new URLSearchParams(window.location.search).get("trial") === "1";
    if (q === "success") toast(trial ? "Your free trial has started. Generate as much as you like today!" : "Thanks! Your plan updates as soon as Stripe confirms the payment.", "success");
    if (q === "credits") toast("Thanks! Your credits are added to your vault as soon as Stripe confirms the payment.", "success");
    if (q === "cancelled") toast("Checkout cancelled. Nothing was charged.", "info");
    if (q) {
      window.history.replaceState(null, "", "/plans");
      setTimeout(refresh, 2500);
    }
  }, [toast, refresh]);

  const me = status?.me;
  const sub = me?.user.billing;

  // Arriving from the public pricing page with a chosen plan: open checkout once the account is loaded.
  const [wanted, setWanted] = useState<{ plan: string; interval: "month" | "year" } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const plan = q.get("plan");
    if (plan && ["creator", "pro", "unlimited"].includes(plan)) {
      setWanted({ plan, interval: q.get("interval") === "year" ? "year" : "month" });
      window.history.replaceState(null, "", "/plans");
    }
  }, []);
  useEffect(() => {
    if (!wanted || !me) return;
    setWanted(null);
    const subscribed = !!me.user.billing?.subscriptionId && me.user.billing?.status !== "canceled";
    if (inNativeApp() || me.plan.id !== "free" || subscribed) return;
    toast("Opening secure checkout…", "info");
    api<{ url: string }>("/api/billing/checkout", { body: { plan: wanted.plan, interval: wanted.interval } })
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [wanted, me, toast]);
  return (
    <>
      <PageHeader title="Plans & Billing" subtitle="Credits pay for AI writing. Everything else is included on every plan. Pro and Unlimited start with a 14-day free trial." />
      {me && (
        <Card className="mb-6 grid grid-cols-1 gap-5 p-5 md:grid-cols-[auto_1fr_1fr_auto] md:items-center">
          <div>
            <p className="label">Current plan</p>
            <p className="mt-1 text-2xl font-semibold text-white">{me.plan.name}</p>
            {sub?.status && (
              <Badge tone={(sub.status === "active" || sub.status === "trialing") && !sub.cancelAtPeriodEnd ? "mint" : "gold"}>
                {sub.cancelAtPeriodEnd && sub.status !== "canceled" ? "cancelled" : sub.status.replace("_", " ")}
                {sub.status === "trialing" && sub.trialEnd
                  ? ` · free until ${new Date(sub.trialEnd).toLocaleDateString()}`
                  : sub.currentPeriodEnd && sub.status !== "canceled"
                    ? ` · ${sub.cancelAtPeriodEnd ? "ends" : "renews"} ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
                    : ""}
              </Badge>
            )}
            {me.trial.active && (
              <p className="mt-2 max-w-[16rem] text-[12px] leading-snug text-white/55">
                {me.ownAi
                  ? "You're on your own AI key, so generating uses no credits."
                  : `Trial bonus: ${me.trial.freeLeftToday} of ${me.trial.freePerDay} free AI credits left today. Your plan's credits arrive in your vault when the first paid month starts.`}
              </p>
            )}
          </div>
          <Usage label="AI credits left in your vault" used={me.creditsLeft} total={Math.max(me.plan.credits, me.creditsLeft)} />
          <Usage label="Posts this month" used={me.user.usage.posts} total={me.plan.postsPerMonth} />
          {sub?.customerId && !inNativeApp() && (
            <Button
              onClick={async () => {
                try {
                  const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" });
                  window.location.href = url;
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <CreditCard className="h-4 w-4" /> Manage billing
            </Button>
          )}
        </Card>
      )}
      {me && <VaultCard me={me} />}
      {me && !inNativeApp() && <PacksCard />}
      <PricingTable currentPlan={me?.plan.id} signedIn hasSubscription={!!sub?.subscriptionId && sub?.status !== "canceled"} trialEligible={me?.trial.eligible ?? false} />
      <p className="mt-6 text-xs text-white/40">Post counts reset on the 1st of each month. Plan credits stay in your vault for 30 days and credit packs for a year; credits that expire unused go to the community pool. Prices in USD; taxes may apply at checkout.</p>
    </>
  );
}

function Usage({ label, used, total }: { label: string; used: number; total: number | null }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white/60">{label}</span>
        <span className="tabular-nums text-white">{used.toLocaleString()} / {total === null ? "Unlimited" : total.toLocaleString()}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-gold-400" style={{ width: `${total === null ? 4 : Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { plan: "Plan credits", migration: "Carried over", pool: "Community pool", refund: "Returned", bonus: "Bonus", pack: "Credit pack" };

/** One-time credit packs for when a plan's monthly credits run out. */
function PacksCard() {
  const { toast } = useApp();
  const [busy, setBusy] = useState("");
  const buy = async (pack: string) => {
    setBusy(pack);
    try {
      const { url } = await api<{ url: string }>("/api/billing/credits", { body: { pack } });
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy("");
    }
  };
  return (
    <Card className="mb-6 p-5">
      <p className="label">Need more credits?</p>
      <p className="mt-1 text-[13px] text-white/60">One-time packs, no subscription change. Pack credits last {PACK_DAYS} days and are used after your plan credits.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CREDIT_PACKS.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
            <p className="text-lg font-semibold text-white">
              {p.credits.toLocaleString()} <span className="text-sm font-normal text-white/50">credits</span>
            </p>
            <p className="text-[12px] leading-snug text-white/55">{p.label}</p>
            <Button className="mt-auto" disabled={!!busy} onClick={() => buy(p.id)}>
              {busy === p.id ? "Opening…" : `Buy for $${p.price}`}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The credit vault: every batch of credits with the day it expires, plus the shared community pool. */
function VaultCard({ me }: { me: Me }) {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const days = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
  const { vault, pool } = me;
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Your credit vault</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {me.creditsLeft.toLocaleString()} <span className="text-sm font-normal text-white/50">credits</span>
          </p>
        </div>
        <p className="max-w-xs text-right text-[12px] leading-snug text-white/55">
          {vault.nextGrantAt
            ? `Next ${vault.nextGrantCredits.toLocaleString()} credits arrive ${fmt(vault.nextGrantAt)}.`
            : "Your plan's credits arrive when your first paid month starts."}
        </p>
      </div>
      {vault.lots.length > 0 ? (
        <ul className="mt-4 grid grid-cols-1 gap-2">
          {vault.lots.map((l, i) => (
            <li key={`${l.expiresAt}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg bg-white/[0.03] px-3 py-2 text-sm ring-1 ring-white/[0.06]">
              <span className="text-white/80">
                <span className="tabular-nums font-medium text-white">{l.credits.toLocaleString()}</span> · {SOURCE_LABEL[l.source] ?? l.source}
              </span>
              <span className={days(l.expiresAt) <= 3 ? "text-gold-300" : "text-white/50"}>
                expires {fmt(l.expiresAt)} · {days(l.expiresAt)} day{days(l.expiresAt) === 1 ? "" : "s"} left
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-white/55">Your vault is empty right now.</p>
      )}
      <p className="mt-4 text-[12px] leading-relaxed text-white/50">
        Each batch stays in your vault for 30 days, and the batch that expires first is used first. Credits that expire unused move to the shared community pool
        (<b className="text-white/70">{pool.balance.toLocaleString()}</b> credits now), which tops up any account that has run out, up to {POOL_PER_USER_DAILY} credits a day each
        {vault.poolAllowanceLeft < POOL_PER_USER_DAILY ? ` (you have ${vault.poolAllowanceLeft} left today)` : ""}.
      </p>
    </Card>
  );
}
