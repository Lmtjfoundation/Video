"use client";
import { useEffect } from "react";
import { CreditCard } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { PricingTable, inNativeApp } from "@/components/pricing";

export default function PlansPage() {
  const { status, toast, refresh } = useApp();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "success") toast("Thanks! Your plan updates as soon as Stripe confirms the payment.", "success");
    if (q === "cancelled") toast("Checkout cancelled. Nothing was charged.", "info");
    if (q) {
      window.history.replaceState(null, "", "/plans");
      setTimeout(refresh, 2500);
    }
  }, [toast, refresh]);

  const me = status?.me;
  const sub = me?.user.billing;
  return (
    <>
      <PageHeader title="Plans & Billing" subtitle="Credits pay for AI writing. Everything else is included on every plan." />
      {me && (
        <Card className="mb-6 grid gap-5 p-5 md:grid-cols-[auto_1fr_1fr_auto] md:items-center">
          <div>
            <p className="label">Current plan</p>
            <p className="mt-1 text-2xl font-semibold text-white">{me.plan.name}</p>
            {sub?.status && <Badge tone={sub.status === "active" ? "mint" : "gold"}>{sub.status}{sub.currentPeriodEnd ? ` · renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}` : ""}</Badge>}
          </div>
          <Usage label="AI credits" used={me.plan.credits - me.creditsLeft} total={me.plan.credits} />
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
      <PricingTable currentPlan={me?.plan.id} signedIn hasSubscription={!!sub?.subscriptionId && sub?.status !== "canceled"} />
      <p className="mt-6 text-xs text-white/40">Credits and post counts reset on the 1st of each month. Unused credits don't roll over. Prices in USD; taxes may apply at checkout.</p>
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
