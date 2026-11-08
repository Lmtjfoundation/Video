"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { SECTIONS } from "@/lib/nav";

/** A section's hub: one card per tool, so every function is one tap from the sidebar. */
export function Hub({ section }: { section: string }) {
  const s = SECTIONS.find((x) => x.key === section)!;
  return (
    <>
      <PageHeader title={s.label} subtitle={s.blurb} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {s.tools.map(({ href, label, blurb, icon: Icon }) => (
          <Link key={href} href={href} className="focus-ring glass group flex items-start gap-3 rounded-2xl p-4 transition-colors hover:bg-white/[0.06]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint-400/[0.1] text-mint-300 ring-1 ring-mint-400/20">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
                {label}
                <ArrowRight className="h-4 w-4 text-white/50 transition-transform group-hover:translate-x-0.5 group-hover:text-mint-300" />
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-white/60">{blurb}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
