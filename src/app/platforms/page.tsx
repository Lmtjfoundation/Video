"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Share2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { Platform, Settings } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { Accounts } from "@/components/accounts";
import { MetricoolCard } from "@/components/metricool-card";
import { Card, PageHeader, PlatformChip } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Platforms tab: link and manage every social account in one place. Turning a platform on or off saves
 * straight away (no separate Save button), within the plan's platform limit.
 */
export default function PlatformsPage() {
  const { status, toast, refresh } = useApp();
  const [platforms, setPlatforms] = useState<Settings["platforms"] | null>(null);

  // Follow the server's switches whenever the status reloads (e.g. after Metricool turns platforms on).
  const serverPlatforms = status?.settings.platforms;
  useEffect(() => {
    if (serverPlatforms) setPlatforms(serverPlatforms);
  }, [serverPlatforms]);

  // Returning from a platform's sign-in page: ?connected=x, ?error=… or ?pick=facebook
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected === "facebook" && q.get("mode") === "profile") toast("Facebook profile linked. Posts will be ready at their time for you to post with one tap.", "success");
    else if (connected && connected in PLATFORM_SPECS) toast(`${PLATFORM_SPECS[connected as Platform].name} account linked`, "success");
    if (q.get("pick") === "facebook") toast("Facebook will post to your Page automatically. To use another Page or your own profile, choose it on the Facebook card.", "info");
    if (error) toast(error, "error");
    if (connected || error || q.get("pick")) {
      window.history.replaceState(null, "", "/platforms");
      refresh();
    }
  }, [toast, refresh]);

  if (!status || !platforms) return <div className="glass h-96 animate-pulse" />;

  const plan = status.me.plan;
  const linked = status.credentials.filter((c) => c.connected).map((c) => c.platform);
  const posting = PLATFORMS.filter((p) => platforms[p] && linked.includes(p));

  async function toggle(next: Settings["platforms"]) {
    const before = platforms;
    setPlatforms(next);
    try {
      const saved = await api<Settings>("/api/settings", { method: "PUT", body: { platforms: next } });
      setPlatforms(saved.platforms);
      toast("Saved", "success");
      refresh();
    } catch (e) {
      setPlatforms(before);
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHeader
        title="Platforms"
        subtitle="Connect the social accounts Ghost Post posts to, and switch each one on or off."
      />

      <Card className="mb-5 grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Share2 className="h-4 w-4 text-mint-300" /> {linked.length} linked · {posting.length} posting · {plan.name} plan includes {plan.maxPlatforms >= PLATFORMS.length ? "every platform" : `${plan.maxPlatforms} platforms`}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <span
                key={p}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] ring-1",
                  linked.includes(p) ? "bg-mint-400/[0.07] text-white ring-mint-400/25" : "bg-white/[0.02] text-white/45 ring-white/[0.06]",
                )}
              >
                <PlatformChip platform={p} /> {linked.includes(p) ? (platforms[p] ? "posting" : "linked, off") : "not linked"}
                {status.credentials.find((c) => c.platform === p)?.via === "metricool" && <span className="text-white/40">· Metricool</span>}
              </span>
            ))}
          </div>
        </div>
        {linked.length >= plan.maxPlatforms && plan.maxPlatforms < PLATFORMS.length && (
          <Link href="/plans" className="inline-flex items-center gap-1 text-sm text-mint-300 hover:underline">
            Need more platforms? Upgrade <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </Card>

      <MetricoolCard status={status.metricool} credentials={status.credentials} />

      <Accounts settings={{ ...status.settings, platforms }} setSettings={toggle} statuses={status.credentials} saveHint="It saves as soon as you flip it." />
    </>
  );
}
