import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { gdb } from "./db";
import { TRIAL_DAILY_FREE_CREDITS, planById, type PlanId } from "./plans";
import { nowIso, uid } from "./utils";
import { addToPool, takeFromPool } from "./credit-pool";
import {
  PACK_DAYS,
  POOL_LOT_DAYS,
  VAULT_DAYS,
  balance,
  debit,
  emptyVault,
  liveLots,
  newLot,
  planCycle,
  planLotExpiry,
  poolAllowanceLeft,
  restore,
  splitExpired,
  utcDay as vaultDay,
  type Vault,
} from "./vault-core";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Role = "admin" | "user";
export interface User {
  id: string;
  kind: "user";
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  status: "active" | "suspended";
  plan: PlanId;
  /** Posts need admin approval before they can publish */
  requireApproval: boolean;
  /** An employee: unlimited use (never spends credits), without admin access. Set by an admin. */
  staff?: boolean;
  /** Credits spent / posts published this calendar month (statistics; the spendable balance lives in `vault`). */
  /** `comp`: credits an admin or employee used without paying, counted so their AI cost shows in Admin. */
  usage: { period: string; credits: number; posts: number; comp?: number };
  /** Spendable credits: lots that each expire 30 days after they were added. See vault-core.ts. */
  vault?: Vault;
  billing?: {
    customerId?: string;
    subscriptionId?: string;
    status?: string;
    interval?: "month" | "year";
    currentPeriodEnd?: string;
    /** true when the customer cancelled: the plan stays active until currentPeriodEnd, then drops to Free. */
    cancelAtPeriodEnd?: boolean;
    /** When the free trial ends (Stripe charges the first paid month then). */
    trialEnd?: string;
    /** Set once a trial has started, so each account gets one free trial. */
    trialUsed?: boolean;
  };
  /** Free AI used today during a trial (credits' worth), so the daily cap can be enforced. */
  trialFree?: { day: string; credits: number };
  /** Where the person came from before signing up (the ?src= of the link they followed, e.g. "tiktok"). */
  signupSource?: string;
  createdAt: string;
  lastLoginAt?: string;
}
/** What the browser may see about a user. */
export type PublicUser = Omit<User, "passwordHash" | "kind">;
export const publicUser = ({ passwordHash: _p, kind: _k, ...u }: User): PublicUser => u;

interface EmailIndex {
  id: string;
  kind: "email";
  userId: string;
}
interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export const SESSION_COOKIE = "np_session";
const SESSION_DAYS = 30;
export const period = () => new Date().toISOString().slice(0, 7);

const emailKey = (email: string) => `email:${email.trim().toLowerCase()}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

/* Passwords: scrypt with a random salt. */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [, s, h] = stored.split("$");
  if (!s || !h) return false;
  const expected = Buffer.from(h, "base64");
  const got = await scrypt(pw, Buffer.from(s, "base64"), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function validatePassword(pw: string) {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number.";
  return null;
}

/* Users */
export async function listUsers(): Promise<User[]> {
  return (await gdb().all<User | EmailIndex>("users", 100_000)).filter((u): u is User => (u as User).kind === "user");
}
export const getUser = (id: string) => gdb().get<User>("users", id);
export async function findUserByEmail(email: string) {
  const idx = await gdb().get<EmailIndex>("users", emailKey(email));
  return idx ? getUser(idx.userId) : null;
}
export async function saveUser(u: User) {
  await gdb().upsert("users", u);
  return u;
}

/** Constant-time check of the owner setup code (only when SETUP_CODE is set on the server). */
export function ownerCodeOk(code?: string) {
  const want = process.env.SETUP_CODE;
  if (!want) return true;
  const got = String(code ?? "").trim();
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
export async function ownerNeeded() {
  return (await listUsers()).length === 0;
}

const adminEmails = () => (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** A ?src= value as it may be stored: short, lowercase letters, digits, dashes and underscores. */
export const cleanSource = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || undefined;

export async function createUser(input: { email: string; password: string; name?: string; setupCode?: string; source?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.", 400);
  const bad = validatePassword(input.password);
  if (bad) throw new AuthError(bad, 400);
  if (await findUserByEmail(email)) throw new AuthError("An account with this email already exists. Sign in instead.", 409);
  const isFirst = (await listUsers()).length === 0;
  // The owner (first) account needs the server's SETUP_CODE, so nobody else can claim a freshly deployed site.
  if (isFirst && !ownerCodeOk(input.setupCode)) throw new AuthError("Enter the owner setup code to create the first (admin) account.", 403);
  const settings = await getAppSettings();
  if (!isFirst && !settings.allowSignups && !adminEmails().includes(email)) throw new AuthError("New sign-ups are closed right now.", 403);

  const user: User = {
    id: uid("usr"),
    kind: "user",
    email,
    name: input.name?.trim().slice(0, 80) || email.split("@")[0],
    passwordHash: await hashPassword(input.password),
    // The very first account (or any ADMIN_EMAILS address) becomes the admin.
    role: isFirst || adminEmails().includes(email) ? "admin" : "user",
    status: "active",
    plan: isFirst || adminEmails().includes(email) ? "unlimited" : "free",
    requireApproval: settings.requireApprovalForNewUsers && !isFirst,
    usage: { period: period(), credits: 0, posts: 0 },
    vault: emptyVault(),
    signupSource: cleanSource(input.source),
    createdAt: nowIso(),
  };
  await gdb().upsertMany("users", [user, { id: emailKey(email), kind: "email", userId: user.id } as EmailIndex]);
  return user;
}

/* Login throttling: 5 failures per email locks it for 15 minutes. */
async function checkThrottle(email: string) {
  const row = await gdb().get<{ id: string; value: { fails: number; until?: number } }>("kv", `login_${sha(email)}`);
  if (row?.value.until && row.value.until > Date.now()) {
    const mins = Math.ceil((row.value.until - Date.now()) / 60_000);
    throw new AuthError(`Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
  }
  return row?.value ?? { fails: 0 };
}
async function recordFailure(email: string, fails: number) {
  const n = fails + 1;
  await gdb().upsert("kv", { id: `login_${sha(email)}`, value: { fails: n, until: n >= 5 ? Date.now() + 15 * 60_000 : undefined } });
}

export async function login(emailIn: string, password: string) {
  const email = emailIn.trim().toLowerCase();
  const t = await checkThrottle(email);
  const user = await findUserByEmail(email);
  // Same message for unknown email and wrong password, so accounts can't be discovered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordFailure(email, t.fails);
    throw new AuthError("Email or password is incorrect.");
  }
  if (user.status === "suspended") throw new AuthError("This account is suspended. Contact support.", 403);
  await gdb().remove("kv", `login_${sha(email)}`);
  user.lastLoginAt = nowIso();
  await saveUser(user);
  return { user, token: await createSession(user.id) };
}

/* Sessions: random token in an httpOnly cookie; only its hash is stored. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const s: Session = { id: sha(token), userId, createdAt: nowIso(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() };
  await gdb().upsert("sessions", s);
  return token;
}
export async function destroySession(token: string) {
  await gdb().remove("sessions", sha(token));
}
export async function destroyAllSessions(userId: string) {
  const mine = (await gdb().all<Session>("sessions", 100_000)).filter((s) => s.userId === userId);
  await gdb().removeMany("sessions", mine.map((s) => s.id));
}

/* Password reset: single-use token emailed to the account address; only its hash is stored, valid for 1 hour. */
const RESET_TTL_MS = 60 * 60_000;
const RESEND_GAP_MS = 2 * 60_000;

/**
 * Creates a reset token for an active account. Returns null for unknown or suspended emails, or when a link was sent
 * less than 2 minutes ago (callers answer the same way either way, so accounts can't be discovered).
 */
export async function createPasswordReset(emailIn: string): Promise<{ token: string; user: User } | null> {
  const email = emailIn.trim().toLowerCase();
  const user = await findUserByEmail(email);
  if (!user || user.status !== "active") return null;
  const gate = await gdb().get<{ id: string; value: { at: number } }>("kv", `forgot_${sha(email)}`);
  if (gate && Date.now() - gate.value.at < RESEND_GAP_MS) return null;
  const token = randomBytes(32).toString("base64url");
  await gdb().upsertMany("kv", [
    { id: `reset_${sha(token)}`, value: { userId: user.id, expiresAt: Date.now() + RESET_TTL_MS } },
    { id: `forgot_${sha(email)}`, value: { at: Date.now() } },
  ]);
  return { token, user };
}

/** Sets a new password from a reset token, signs out every other device and returns a fresh session. */
export async function resetPassword(token: string, password: string) {
  const bad = validatePassword(password ?? "");
  if (bad) throw new AuthError(bad, 400);
  const id = `reset_${sha(String(token ?? ""))}`;
  const row = await gdb().get<{ id: string; value: { userId: string; expiresAt: number } }>("kv", id);
  if (!row || row.value.expiresAt < Date.now()) {
    if (row) await gdb().remove("kv", id);
    throw new AuthError("This reset link has expired or was already used. Request a new one.", 400);
  }
  const user = await getUser(row.value.userId);
  await gdb().remove("kv", id); // single use
  if (!user || user.status !== "active") throw new AuthError("This account can't be reset. Contact support.", 403);
  user.passwordHash = await hashPassword(password);
  await saveUser(user);
  await destroyAllSessions(user.id);
  await gdb().remove("kv", `login_${sha(user.email)}`);
  return { user, token: await createSession(user.id) };
}

export function readCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function sessionCookie(token: string | null) {
  const secure = (process.env.APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
    : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function userFromRequest(req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const s = await gdb().get<Session>("sessions", sha(token));
  if (!s || new Date(s.expiresAt).getTime() < Date.now()) return null;
  const u = await getUser(s.userId);
  if (!u || u.status !== "active") return null;
  return rollUsage(u);
}

/** Reset monthly usage counters when a new month starts. */
export async function rollUsage(u: User) {
  if (u.usage?.period !== period()) {
    u.usage = { period: period(), credits: 0, posts: 0 };
    await saveUser(u);
  }
  return u;
}

/* App-wide settings the admin controls. */
export interface AppSettings {
  id: "app_settings";
  allowSignups: boolean;
  requireApprovalForNewUsers: boolean;
  supportEmail: string;
  /** Business name shown on the Terms and Privacy pages (defaults to "Ghost Post"). */
  legalName: string;
  /** Governing law shown in the Terms (defaults to the State of Texas, USA). */
  legalJurisdiction: string;
}
const DEFAULT_APP: AppSettings = {
  id: "app_settings",
  allowSignups: true,
  requireApprovalForNewUsers: false,
  supportEmail: "",
  legalName: "",
  legalJurisdiction: "",
};
export async function getAppSettings(): Promise<AppSettings> {
  const row = await gdb().get<{ id: string; value: Partial<AppSettings> }>("kv", "app_settings");
  const s = { ...DEFAULT_APP, ...(row?.value ?? {}) };
  // Server variables fill in anything not set in Admin → App settings.
  return {
    ...s,
    supportEmail: s.supportEmail || process.env.SUPPORT_EMAIL || "",
    legalName: s.legalName || process.env.LEGAL_NAME || "",
    legalJurisdiction: s.legalJurisdiction || process.env.LEGAL_JURISDICTION || "",
  };
}
export async function saveAppSettings(patch: Partial<AppSettings>) {
  // Merge into what's stored (not the env-filled view), so server variables stay a fallback.
  const row = await gdb().get<{ id: string; value: Partial<AppSettings> }>("kv", "app_settings");
  const next = { ...DEFAULT_APP, ...(row?.value ?? {}), ...patch, id: "app_settings" as const };
  await gdb().upsert("kv", { id: "app_settings", value: next });
  return getAppSettings();
}

/* Quotas */
export class QuotaError extends Error {
  status = 402;
}

/* Credit vault */

/**
 * Brings an account's vault up to date, and saves it if anything changed:
 * 1. Accounts from before the vault existed get what they had left this month, in one lot.
 * 2. Lots past their 30 days are removed and their credits move to the community pool.
 * 3. The plan's credits for the current billing cycle are added once (an upgrade adds the difference).
 */
export async function rollVault(u: User, now = Date.now()): Promise<User> {
  await rollUsage(u);
  const plan = planById(u.plan);
  const cycle = planCycle(u, plan, now);
  let changed = false;

  if (!u.vault) {
    const v = emptyVault();
    if (cycle) {
      v.cycle = { key: cycle.key, granted: cycle.credits };
      const left = Math.max(0, plan.credits - u.usage.credits);
      if (left > 0) v.lots.push(newLot(uid("lot"), left, "migration", now, now + VAULT_DAYS * 86_400_000));
    }
    u.vault = v;
    changed = true;
  }
  const v = u.vault;

  const { live, expired } = splitExpired(v.lots, now);
  if (expired > 0 || live.length !== v.lots.length) {
    v.lots = live;
    changed = true;
  }
  if (cycle) {
    if (v.cycle.key !== cycle.key) {
      v.cycle = { key: cycle.key, granted: 0 };
      changed = true;
    }
    if (cycle.credits > v.cycle.granted) {
      v.lots.push(newLot(uid("lot"), cycle.credits - v.cycle.granted, "plan", now, planLotExpiry(cycle, now)));
      v.cycle.granted = cycle.credits;
      changed = true;
    }
  }
  if (changed) await saveUser(u);
  // After the save, so a failed save can never count the same expired credits twice.
  if (expired > 0) await addToPool(expired, now);
  return u;
}

/** What the browser shows about an account's vault (call rollVault first). */
export function vaultSummary(u: User, now = Date.now()) {
  const v = u.vault ?? emptyVault();
  const cycle = planCycle(u, planById(u.plan), now);
  return {
    balance: balance(v.lots, now),
    lots: liveLots(v.lots, now).map((l) => ({ credits: l.credits, expiresAt: l.expiresAt, source: l.source })),
    nextGrantAt: cycle ? new Date(cycle.next).toISOString() : null,
    nextGrantCredits: cycle?.credits ?? 0,
    poolAllowanceLeft: poolAllowanceLeft(v, now),
  };
}

const shortDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Deducts credits before an AI action. Call refundCredits if the action then fails. */
export async function spendCredits(userId: string, n: number) {
  const u = await getUser(userId);
  if (!u) throw new AuthError("Account not found.");
  const now = Date.now();
  // The app's owner (admin) pays for the AI through their own keys, so their account never uses credits; nor do employees.
  if (u.role === "admin" || u.staff) {
    await rollUsage(u);
    u.usage.comp = (u.usage.comp ?? 0) + n;
    await saveUser(u);
    return balance(u.vault?.lots ?? [], now);
  }
  await rollVault(u, now);
  const v = u.vault!;
  let have = balance(v.lots, now);

  // Short on credits: the community pool covers the gap (a few credits a day), all or nothing.
  if (have < n) {
    const need = n - have;
    if (need <= poolAllowanceLeft(v, now) && (await takeFromPool(need, now))) {
      v.lots.push(newLot(uid("lot"), need, "pool", now, now + POOL_LOT_DAYS * 86_400_000));
      const day = vaultDay(now);
      v.poolDay = { day, credits: (v.poolDay?.day === day ? v.poolDay.credits : 0) + need };
      have += need;
    }
  }
  if (have < n) {
    const plan = planById(u.plan);
    const cycle = planCycle(u, plan, now);
    const when = cycle
      ? `Your next ${plan.credits.toLocaleString()} credits arrive ${shortDate(cycle.next)}.`
      : trialActive(u)
        ? `Your plan's credits arrive when your free trial ends (${shortDate(Date.parse(u.billing!.trialEnd!))}).`
        : "Update your payment method on the Plans page to get your plan's credits.";
    throw new QuotaError(`This needs ${n} credit${n === 1 ? "" : "s"} and your vault has ${have}. ${when} Upgrade on the Plans page for more.`);
  }
  v.lots = debit(v.lots, n, now)!;
  u.usage.credits += n;
  await saveUser(u);
  return balance(v.lots, now);
}
export async function refundCredits(userId: string, n: number) {
  const u = await getUser(userId);
  if (!u) return;
  if (u.role === "admin" || u.staff) {
    // Nothing was taken from an admin or employee; only the free-use count goes back down.
    u.usage.comp = Math.max(0, (u.usage.comp ?? 0) - n);
    await saveUser(u);
    return;
  }
  u.vault = u.vault ?? emptyVault();
  u.vault.lots = restore(u.vault.lots, n, Date.now(), uid("lot"));
  u.usage.credits = Math.max(0, u.usage.credits - n);
  await saveUser(u);
}

/** Adds a purchased credit pack to the person's vault as one lot that lasts PACK_DAYS. */
export async function addPackCredits(userId: string, credits: number) {
  const u = await getUser(userId);
  if (!u || credits <= 0) return null;
  const now = Date.now();
  await rollVault(u, now);
  u.vault!.lots.push(newLot(uid("lot"), credits, "pack", now, now + PACK_DAYS * 86_400_000));
  await saveUser(u);
  return balance(u.vault!.lots, now);
}

/** Checks the monthly post allowance; records one post when `commit` is true. */
export async function usePostAllowance(userId: string, commit: boolean) {
  const u = await getUser(userId);
  if (!u) return { ok: false, reason: "Account not found." };
  await rollUsage(u);
  const plan = planById(u.plan);
  if (plan.postsPerMonth !== null && u.usage.posts >= plan.postsPerMonth) {
    return { ok: false, reason: `Monthly limit of ${plan.postsPerMonth} posts reached on ${plan.name}. Upgrade to keep publishing.` };
  }
  if (commit) {
    u.usage.posts += 1;
    await saveUser(u);
  }
  return { ok: true };
}

/* Free trial */

/** True while a Stripe trial is running for this account. */
export const trialActive = (u: User) =>
  u.billing?.status === "trialing" && !!u.billing.trialEnd && new Date(u.billing.trialEnd).getTime() > Date.now();

/** One trial per account: not after a trial has been used or a paid subscription has existed. */
export const trialEligible = (u: User) => !u.billing?.trialUsed && !u.billing?.subscriptionId;

const utcDay = () => new Date().toISOString().slice(0, 10);

/** Free AI left today for a trialing account (credits' worth); 0 when not on a trial. */
export function trialFreeLeft(u: User) {
  if (!trialActive(u)) return 0;
  const used = u.trialFree?.day === utcDay() ? u.trialFree.credits : 0;
  return Math.max(0, TRIAL_DAILY_FREE_CREDITS - used);
}

/** Uses the trial's free daily AI allowance instead of credits. Returns false when not trialing or the day's allowance is used up. */
export async function spendTrialFree(userId: string, n: number) {
  const u = await getUser(userId);
  if (!u || trialFreeLeft(u) < n) return false;
  const day = utcDay();
  u.trialFree = { day, credits: (u.trialFree?.day === day ? u.trialFree.credits : 0) + n };
  await saveUser(u);
  return true;
}
export async function refundTrialFree(userId: string, n: number) {
  const u = await getUser(userId);
  if (!u?.trialFree || u.trialFree.day !== utcDay()) return;
  u.trialFree.credits = Math.max(0, u.trialFree.credits - n);
  await saveUser(u);
}
