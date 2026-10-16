import Link from "next/link";
import { Activity } from "lucide-react";
import { PricingTable } from "@/components/pricing";
import { LegalFooter } from "@/components/legal-footer";
import { plansPayload } from "@/lib/plans-public";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pricing · Ghost Post",
  description: "Niche research, AI story scripts, video rendering and auto-posting to X, Facebook, Instagram, LinkedIn, YouTube and TikTok. Start free.",
};

export default async function PricingPage() {
  const initial = await plansPayload();
  return (
    <div className="relative z-10 mx-auto max-w-[1200px] px-5 py-12">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500"><Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} /></span>
          <span className="font-semibold text-white">Ghost Post</span>
        </Link>
        <div className="flex gap-3 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-white/70 hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-mint-400 px-3 py-2 font-medium text-ink-950">Start free</Link>
        </div>
      </header>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white">Research the niche, write the story, post everywhere.</h1>
      <p className="mb-10 mt-3 max-w-2xl text-white/60">One plan replaces a scheduler, a script writer and a niche research tool. Start free; upgrade when it's paying for itself.</p>
      <PricingTable signedIn={false} initial={initial} />
      <p className="mt-6 text-xs text-white/40">
        Prices in USD. Paid plans renew automatically each month or year until cancelled; cancel any time from Plans &amp; Billing and keep your plan until the end of the period.
        Post allowances reset on the 1st of each month. AI credits are added to your vault each billing period and stay there for 30 days; credits that expire unused move to a shared community pool that tops up other accounts.
      </p>
      <LegalFooter />
    </div>
  );
}
