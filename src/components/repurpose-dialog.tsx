"use client";
import { useState } from "react";
import Link from "next/link";
import { Lock, Repeat2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { CREDIT_COST } from "@/lib/plans";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { PLATFORMS, type Platform } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, PlatformChip } from "./ui";

export function RepurposeDialog({ storyId, postId, onClose }: { storyId?: string; postId?: string; onClose: () => void }) {
  const { status, toast, refresh } = useApp();
  const enabled = PLATFORMS.filter((p) => status?.settings.platforms[p]);
  const [pick, setPick] = useState<Platform[]>(enabled.length ? enabled : ["x", "linkedin"]);
  const [busy, setBusy] = useState(false);
  const allowed = status?.me.plan.features.repurpose ?? false;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-md p-6" role="dialog" aria-modal="true" aria-label="Repurpose" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white">Repurpose everywhere</h3>
        <p className="mt-1 text-sm text-white/55">Writes a native draft for each platform: different hook, length and structure. {CREDIT_COST.repurposePerPlatform} credit per platform.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {PLATFORMS.map((p) => (
            <label key={p} className={cn("flex cursor-pointer items-center gap-2 rounded-xl p-2.5 ring-1", pick.includes(p) ? "bg-mint-400/[0.06] ring-mint-400/40" : "ring-white/10")}>
              <input type="checkbox" checked={pick.includes(p)} onChange={() => setPick((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))} className="accent-[#3ef0a8]" />
              <PlatformChip platform={p} /> <span className="text-sm text-white/80">{PLATFORM_SPECS[p].name}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          {allowed ? (
            <Button
              variant="primary"
              loading={busy}
              disabled={!pick.length}
              onClick={async () => {
                setBusy(true);
                try {
                  const posts = await api<unknown[]>("/api/repurpose", { body: { storyId, postId, platforms: pick } });
                  toast(`${posts.length} drafts added to Content Studio`, "success");
                  refresh();
                  onClose();
                } catch (e) {
                  toast((e as Error).message, "error");
                  setBusy(false);
                }
              }}
            >
              <Repeat2 className="h-4 w-4" /> Write {pick.length} draft{pick.length === 1 ? "" : "s"} · {pick.length * CREDIT_COST.repurposePerPlatform} credits
            </Button>
          ) : (
            <Link href="/plans"><Button variant="gold"><Lock className="h-4 w-4" /> Included from Creator</Button></Link>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
