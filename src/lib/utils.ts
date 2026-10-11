import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${id}` : id;
}

export const nowIso = () => new Date().toISOString();

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function usd(n: number) {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 100) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Word-set Jaccard similarity, used to stop the agent repeating itself. */
export function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const A = norm(a);
  const B = norm(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

export const PILLAR_LABEL: Record<string, string> = {
  ai_leverage: "AI Money & Leverage",
  high_agency: "High-Agency Psychology",
  wealth_systems: "Wealth Systems",
  relationships: "Modern Relationships",
  longevity: "Longevity & Body Capital",
};

export const FORMAT_LABEL: Record<string, string> = {
  short: "Short post",
  thread: "Thread",
  carousel: "Carousel",
  video_script: "Video script",
  caption: "Caption + hook",
};

export const MODE_LABEL: Record<string, string> = {
  auto: "Auto (best fit)",
  quick_witty: "Quick witty",
  deep_insight: "Deep insight",
  supportive: "Supportive motivation",
  candid: "Candid (frank, non-explicit)",
  value_add: "Value-add",
};
