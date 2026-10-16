import Link from "next/link";
import { Activity } from "lucide-react";
import { getAppSettings } from "@/lib/auth";
import { LegalFooter } from "./legal-footer";

export const LEGAL_UPDATED = "October 11, 2026";

/** Business details the owner sets in Admin → App settings. */
export async function legalInfo() {
  const s = await getAppSettings();
  return {
    name: s.legalName || "Ghost Post",
    email: s.supportEmail || "",
    law: s.legalJurisdiction || "the State of Texas, USA",
  };
}

export function Contact({ email }: { email: string }) {
  return email ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    <span>the support email shown here (the operator hasn&apos;t added it yet)</span>
  );
}

export function LegalShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="relative z-10 mx-auto max-w-3xl px-5 py-10">
      <header className="mb-10 flex items-center justify-between gap-4">
        <Link href="/pricing" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500">
            <Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} />
          </span>
          <span className="font-semibold text-white">Ghost Post</span>
        </Link>
        <nav className="flex gap-1 text-sm">
          <Link href="/pricing" className="rounded-lg px-3 py-2 text-white/60 hover:text-white">Pricing</Link>
          <Link href="/login" className="rounded-lg px-3 py-2 text-white/60 hover:text-white">Sign in</Link>
        </nav>
      </header>
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-white/45">Last updated {LEGAL_UPDATED}</p>
      {intro && <p className="mt-5 text-[15px] leading-relaxed text-white/75">{intro}</p>}
      <article className="legal mt-8 text-[15px] leading-relaxed text-white/75 [&_a]:text-mint-300 [&_a:hover]:underline [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_li]:mt-1.5 [&_p]:mt-3 [&_strong]:text-white/90 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </article>
      <LegalFooter />
    </div>
  );
}
