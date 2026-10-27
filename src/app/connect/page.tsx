"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, CircleAlert, Settings2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import type { CredentialStatus, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Card, PageHeader, PlatformChip } from "@/components/ui";

/** The networks a person signs in to (the webhook is set up on the Platforms tab). */
const NETWORKS: Platform[] = ["instagram", "facebook", "tiktok", "youtube", "linkedin", "x"];

/** Where to go next: only a path inside the app. */
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/connect") ? n : "/");

/**
 * "Connect your accounts": shown right after signing up or in, until an account is connected. One tap per network
 * opens that network's own sign-in and comes straight back here with a tick.
 */
function Connect() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const status = useApp((s) => s.status);
  const isOwner = status?.me.user.role === "admin";
  const [list, setList] = useState<CredentialStatus[] | null>(null);
  const error = params.get("error");
  const done = params.get("connected") || params.get("ok");

  useEffect(() => {
    api<CredentialStatus[]>("/api/credentials").then(setList).catch(() => setList([]));
  }, []);

  const connected = (list ?? []).filter((s) => NETWORKS.includes(s.platform) && s.connected);
  const here = `/connect?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6">
      <PageHeader title="Connect your accounts" subtitle="Tap a network and sign in there. You come straight back here, and Ghost Post can post for you. You can add more later on the Platforms tab." />
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/25">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {done && !error && <p className="rounded-xl bg-mint-400/10 px-4 py-3 text-sm text-mint-200 ring-1 ring-mint-400/25">Connected. Add another, or continue when you're ready.</p>}
      {params.get("pick") === "facebook" && (
        <p className="rounded-xl bg-gold-300/10 px-4 py-3 text-sm text-white/80 ring-1 ring-gold-300/30">
          Facebook is connected. <Link href="/platforms" className="text-mint-300 underline">Choose which Page (or your profile) to post to</Link>.
        </p>
      )}
      <Card>
        <ul className="divide-y divide-white/[0.06]">
          {NETWORKS.map((p) => {
            const st = list?.find((s) => s.platform === p);
            const spec = PLATFORM_SPECS[p];
            return (
              <li key={p} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <PlatformChip platform={p} className="h-9 min-w-9 text-sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-white">{spec.name}</div>
                  <div className="truncate text-xs text-white/50">
                    {!list ? "Checking…" : st?.connected ? `Connected${st.handle ? ` as ${st.handle}` : ""}` : st?.oauthReady ? "Sign in with one tap" : isOwner ? "Needs a one-time setup first" : "Not available yet"}
                  </div>
                </div>
                {st?.connected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-mint-400/10 px-3 py-2 text-sm text-mint-300"><Check className="h-4 w-4" /> Connected</span>
                ) : st?.oauthReady ? (
                  <a href={`/api/connect/${p}?return=${encodeURIComponent(here)}`}>
                    <Button variant="primary" aria-label={`Continue with ${spec.name}`}>
                      <span className="sm:hidden">Connect</span>
                      <span className="hidden sm:inline">Continue with {spec.name}</span>
                    </Button>
                  </a>
                ) : isOwner && list ? (
                  <Link href="/platforms"><Button><Settings2 className="h-4 w-4" /> Set up</Button></Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/45">Instagram needs a Creator or Business account (free: Instagram → Settings → Account type and tools).</p>
        <a href={next}>
          <Button variant={connected.length ? "primary" : "secondary"}>
            {connected.length ? "Continue" : "Skip for now"} <ArrowRight className="h-4 w-4" />
          </Button>
        </a>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Connect />
    </Suspense>
  );
}
