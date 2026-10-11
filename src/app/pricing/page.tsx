import Link from "next/link";
import { Activity } from "lucide-react";
import { PricingTable } from "@/components/pricing";
import { LegalFooter } from "@/components/legal-footer";

export const metadata = { title: "Pricing · Nexus Pulse" };

export default function PricingPage() {
  return (
    <div className="relative z-10 mx-auto max-w-[1200px] px-5 py-12">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500"><Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} /></span>
          <span className="font-semibold text-white">Nexus Pulse</span>
        </Link>
        <div className="flex gap-3 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-white/70 hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-mint-400 px-3 py-2 font-medium text-ink-950">Start free</Link>
        </div>
      </header>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white">Research the niche, write the story, post everywhere.</h1>
      <p className="mb-10 mt-3 max-w-2xl text-white/60">One plan replaces a scheduler, a script writer and a niche research tool. Start free; upgrade when it's paying for itself.</p>
      <PricingTable signedIn={false} />
      <p className="mt-6 text-xs text-white/40">
        Prices in USD. Paid plans renew automatically each month or year until cancelled; cancel any time from Plans &amp; Billing and keep your plan until the end of the period.
        AI credits and post allowances reset on the 1st of each month.
      </p>
      <LegalFooter />
    </div>
  );
}
