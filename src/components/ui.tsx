"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import type { Platform } from "@/lib/types";

/* Button — shadcn-style API */
const buttonVariants = cva(
  "focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-mint-300 to-mint-500 text-ink-950 shadow-glow hover:brightness-110",
        gold: "bg-gradient-to-b from-gold-300 to-gold-400 text-ink-950 shadow-[0_8px_30px_-10px_rgba(255,204,77,.55)] hover:brightness-110",
        secondary: "border border-white/10 bg-white/[0.04] text-white/90 hover:bg-white/[0.08]",
        ghost: "text-white/70 hover:bg-white/[0.06] hover:text-white",
        danger: "border border-red-400/25 bg-red-500/10 text-red-300 hover:bg-red-500/20",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-10 px-4", lg: "h-12 px-6 text-[15px]", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, children, disabled, ...props },
  ref,
) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass relative", className)} {...p} />;
}

export function CardHeader({ title, subtitle, action, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 rounded-lg bg-white/[0.06] p-2 text-mint-300">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-white/50">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const fieldBase =
  "focus-ring w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 text-sm text-white placeholder:text-white/30 transition-colors hover:border-white/20";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-10", className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...p },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-[90px] py-2.5 leading-relaxed", className)} {...p} />;
});

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(fieldBase, "h-10 appearance-none pr-9")} {...p}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[13px] font-medium text-white/80">{children}</span>
      {hint && <span className="text-[11px] text-white/40">{hint}</span>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <Label hint={hint}>{label}</Label>
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, tone = "mint" }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; tone?: "mint" | "red" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
        checked ? (tone === "red" ? "border-red-400/40 bg-red-500/70" : "border-mint-400/40 bg-mint-500/80") : "border-white/10 bg-white/10",
      )}
    >
      <span className={cn("inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-[3px]")} />
    </button>
  );
}

const badgeTones = {
  neutral: "bg-white/[0.06] text-white/70 ring-white/10",
  mint: "bg-mint-400/10 text-mint-300 ring-mint-400/25",
  gold: "bg-gold-400/10 text-gold-300 ring-gold-400/25",
  red: "bg-red-500/10 text-red-300 ring-red-400/25",
  violet: "bg-violet-500/10 text-violet-300 ring-violet-400/25",
  sky: "bg-sky-500/10 text-sky-300 ring-sky-400/25",
};
export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof badgeTones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", badgeTones[tone], className)}>{children}</span>;
}

export function PlatformChip({ platform, className }: { platform: Platform; className?: string }) {
  const s = PLATFORM_SPECS[platform];
  return (
    <span title={s.name} className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[11px] font-bold ring-1 ring-inset", s.chip, className)}>
      {s.short}
    </span>
  );
}

const STATUS_TONE: Record<string, keyof typeof badgeTones> = {
  draft: "neutral",
  scheduled: "sky",
  publishing: "violet",
  published: "mint",
  failed: "red",
  copy_ready: "gold",
  pending_approval: "gold",
  pending_review: "gold",
  rejected: "red",
  approved: "sky",
  sending: "violet",
  sent: "mint",
  skipped: "neutral",
  blocked: "red",
  escalated: "red",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace("_", " ")}</Badge>;
}

/** Circular money score 0–100 */
export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? "#3ef0a8" : score >= 50 ? "#ffcc4d" : "#f87171";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Money score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth="4" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.max(0, Math.min(100, score))) / 100}
          style={{ transition: "stroke-dashoffset .6s ease", filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[12px] font-semibold tabular-nums text-white">{score}</span>
    </div>
  );
}

export function Stat({ label, value, sub, icon, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; accent?: "mint" | "gold" | "violet" | "red" }) {
  const glow = { mint: "from-mint-400/20", gold: "from-gold-400/20", violet: "from-violet-500/20", red: "from-red-500/20" }[accent ?? "mint"];
  return (
    <Card className="overflow-hidden p-5">
      <div className={cn("pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br to-transparent blur-2xl", glow)} />
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon && <span className="text-white/40">{icon}</span>}
      </div>
      <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight text-white tabular-nums">{value}</div>
      {sub && <div className="mt-2 text-xs text-white/45">{sub}</div>}
    </Card>
  );
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 rounded-2xl bg-white/[0.04] p-4 text-white/40 ring-1 ring-white/10">{icon}</div>}
      <p className="font-medium text-white/85">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-white/45">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
