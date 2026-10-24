"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

type Job = { id: string; title: string; status: "queued" | "running" | "done" | "failed"; message: string; progress: number; href?: string; updatedAt: string };

/**
 * Videos being made in the background: a small tray on every page with each one's progress, a message (and a
 * browser notification, if allowed) when one is ready, and a link to open it.
 */
export function JobsTray() {
  const { toast, refresh } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef<Map<string, Job["status"]> | null>(null);
  const mounted = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const { jobs: list } = await api<{ jobs: Job[] }>("/api/jobs");
      const before = seen.current;
      if (before) {
        for (const j of list) {
          const was = before.get(j.id);
          // Announce each job once when it finishes, including one that started and finished between two checks.
          const finished = j.status === "done" || j.status === "failed";
          const wasOpen = was === "queued" || was === "running" || (was === undefined && Date.parse(j.updatedAt) > mounted.current);
          if (finished && wasOpen) {
            const text = j.status === "done" ? `Ready: ${j.title}` : `Couldn't finish “${j.title}”: ${j.message}`;
            toast(text, j.status === "done" ? "success" : "error");
            try {
              if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") new Notification("Ghost Post", { body: text });
            } catch {
              /* ignore */
            }
            refresh();
            window.dispatchEvent(new Event("ghostpost:job-done"));
          }
        }
      }
      seen.current = new Map(list.map((j) => [j.id, j.status]));
      setJobs(list);
    } catch {
      /* signed out or offline: try again on the next tick */
    }
  }, [toast, refresh]);

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    load();
    const now = () => {
      setOpen(true);
      load();
    };
    window.addEventListener("ghostpost:jobs", now);
    return () => window.removeEventListener("ghostpost:jobs", now);
  }, [load]);
  useEffect(() => {
    const t = setInterval(load, active.length ? 4000 : 30_000);
    return () => clearInterval(t);
  }, [load, active.length]);

  const recent = jobs.slice(0, 8);
  if (!recent.length) return null;
  const done = jobs.filter((j) => j.status === "done").length;

  async function clear() {
    try {
      setJobs((await api<{ jobs: Job[] }>("/api/jobs", { method: "DELETE" })).jobs);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed right-4 top-[calc(env(safe-area-inset-top)+64px)] z-50 w-[calc(100%-2rem)] max-w-xs lg:bottom-4 lg:left-[17rem] lg:right-auto lg:top-auto">
      {open ? (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-sm font-semibold text-white">{active.length ? `Making ${active.length} in the background` : "Background jobs"}</p>
            <div className="flex items-center gap-1">
              {jobs.some((j) => j.status === "done" || j.status === "failed") && (
                <button onClick={clear} className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-white/50 hover:text-white">Clear</button>
              )}
              <button onClick={() => setOpen(false)} className="focus-ring rounded p-1 text-white/50 hover:text-white" aria-label="Hide"><ChevronDown className="h-4 w-4" /></button>
            </div>
          </div>
          <ul className="max-h-80 divide-y divide-white/[0.06] overflow-y-auto">
            {recent.map((j) => (
              <li key={j.id} className="px-4 py-2.5">
                <div className="flex items-start gap-2">
                  {j.status === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-300" /> : j.status === "failed" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-gold-300" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-white">{j.title}</p>
                    <p className={cn("line-clamp-2 text-[11.5px]", j.status === "failed" ? "text-red-200/80" : "text-white/50")}>{j.message}</p>
                    {(j.status === "queued" || j.status === "running") && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${Math.max(4, j.progress)}%` }} />
                      </div>
                    )}
                  </div>
                  {j.href && j.status === "done" && (
                    <Link href={j.href} onClick={() => setOpen(false)} className="shrink-0 rounded-lg bg-mint-400/15 px-2 py-1 text-[11px] font-semibold text-mint-200 hover:bg-mint-400/25">Open</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="focus-ring ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-ink-900/95 px-3.5 py-2 text-[12.5px] font-medium text-white shadow-2xl backdrop-blur-xl">
          {active.length ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gold-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-mint-300" />}
          {active.length ? `Making ${active.length}…` : `${done} ready`}
        </button>
      )}
    </div>
  );
}
