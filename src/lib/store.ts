"use client";
import { create } from "zustand";
import { api } from "./client";
import type { CredentialStatus, LogEntry, Post, Settings } from "./types";
import type { Plan } from "./plans";
import type { OwnAiStatus } from "./ai-providers";
import type { MetricoolStatus } from "./metricool";

export interface Me {
  user: { id: string; email: string; name: string; role: "admin" | "user"; status: string; plan: string; requireApproval: boolean; usage: { period: string; credits: number; posts: number }; billing?: { status?: string; interval?: string; currentPeriodEnd?: string; cancelAtPeriodEnd?: boolean; customerId?: string; subscriptionId?: string; trialEnd?: string; trialUsed?: boolean } };
  plan: Plan;
  creditsLeft: number;
  postsLeft: number | null;
  /** Free trial: whether it's running, when it ends, whether this account can still start one, and today's free AI left. */
  trial: { active: boolean; endsAt: string | null; eligible: boolean; freeLeftToday: number; freePerDay: number };
  /** The subscriber's own AI connection (Settings → AI), or null when the app's AI is used. */
  ownAi: OwnAiStatus | null;
}

export interface StatusPayload {
  me: Me;
  settings: Settings;
  env: { llm: boolean; storage: "local" | "supabase"; encryption: boolean; cron: boolean; stripe: boolean; appUrl: boolean };
  /** Admins only: whether Claude is working app-wide right now (null until the first AI call or test). */
  llmHealth?: { ok: boolean; message?: string; at: string } | null;
  credentials: CredentialStatus[];
  cooldowns: Record<string, number>;
  stats: {
    scheduled: number;
    publishedToday: number;
    copyReady: number;
    failed: number;
    drafts: number;
    inReview: number;
    rejected: number;
    pendingReplies: number;
    escalated: number;
    repliesSent: number;
    weekRevenueLow: number;
    weekRevenueHigh: number;
    avgMoneyScore: number;
  };
  upcoming: Post[];
  /** Posts ready for the person to post on their Facebook profile (Facebook doesn't let apps post to profiles). */
  readyForYou?: { id: string; hook: string; kind: string; readyAt: string }[];
  readyForYouCount?: number;
  /** The person's Metricool connection (accounts connected there are used without developer setup). */
  metricool?: MetricoolStatus;
  logs: LogEntry[];
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface AppState {
  status: StatusPayload | null;
  loading: boolean;
  toasts: Toast[];
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings | null>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
  logout: () => Promise<void>;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  status: null,
  loading: false,
  toasts: [],
  refresh: async () => {
    set({ loading: true });
    try {
      const status = await api<StatusPayload>("/api/status");
      set({ status });
    } catch (e) {
      get().toast((e as Error).message, "error");
    } finally {
      set({ loading: false });
    }
  },
  updateSettings: async (patch) => {
    try {
      const settings = await api<Settings>("/api/settings", { method: "PUT", body: patch });
      const s = get().status;
      if (s) set({ status: { ...s, settings } });
      return settings;
    } catch (e) {
      get().toast((e as Error).message, "error");
      return null;
    }
  },
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 3800);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  logout: async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  },
}));
