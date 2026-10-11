import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { gdb } from "./db";
import { planById, type PlanId } from "./plans";
import { nowIso, uid } from "./utils";

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
  usage: { period: string; credits: number; posts: number };
  billing?: {
    customerId?: string;
    subscriptionId?: string;
    status?: string;
    interval?: "month" | "year";
    currentPeriodEnd?: string;
    /** true when the customer cancelled: the plan stays active until currentPeriodEnd, then drops to Free. */
    cancelAtPeriodEnd?: boolean;
  };
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

export async function createUser(input: { email: string; password: string; name?: string; setupCode?: string }) {
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
  /** Business name shown on the Terms and Privacy pages (defaults to "Nexus Pulse"). */
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

/** Deducts credits before an AI action. Call refundCredits if the action then fails. */
export async function spendCredits(userId: string, n: number) {
  const u = await getUser(userId);
  if (!u) throw new AuthError("Account not found.");
  await rollUsage(u);
  const plan = planById(u.plan);
  const left = plan.credits - u.usage.credits;
  if (left < n) {
    throw new QuotaError(`This needs ${n} credit${n === 1 ? "" : "s"} and you have ${Math.max(0, left)} left this month on ${plan.name}. Upgrade on the Plans page, or wait for the reset on the 1st.`);
  }
  u.usage.credits += n;
  await saveUser(u);
  return plan.credits - u.usage.credits;
}
export async function refundCredits(userId: string, n: number) {
  const u = await getUser(userId);
  if (!u) return;
  u.usage.credits = Math.max(0, u.usage.credits - n);
  await saveUser(u);
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
