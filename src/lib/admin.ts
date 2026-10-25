import "server-only";
import { allOwners, asUser } from "./db";
import { destroyAllSessions, getUser, hashPassword, listUsers, publicUser, saveUser, validatePassword, type User } from "./auth";
import { EST_COST_CENTS_PER_CREDIT, PLANS, planById, type PlanId } from "./plans";
import { poolSnapshot } from "./credit-pool";
import { balance } from "./vault-core";
import { getPost, getSettings, log, savePost } from "./repo";
import { finalizePost } from "./generate";
import type { Post } from "./types";

export async function adminUsers() {
  const users = await listUsers();
  const posts = await allOwners<Post>("posts", 100_000);
  const counts = new Map<string, { total: number; scheduled: number; review: number }>();
  for (const { owner, row } of posts) {
    const c = counts.get(owner) ?? { total: 0, scheduled: 0, review: 0 };
    c.total++;
    if (row.status === "scheduled") c.scheduled++;
    if (row.status === "pending_review") c.review++;
    counts.set(owner, c);
  }
  const owner = originalOwner(users);
  return users
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((u) => ({
      ...publicUser(u),
      counts: counts.get(u.id) ?? { total: 0, scheduled: 0, review: 0 },
      planInfo: planById(u.plan),
      isOwner: u.id === owner?.id,
      isCoOwner: u.role === "admin" && u.plan === "unlimited" && u.id !== owner?.id,
    }));
}

/** The account that set the app up: the first admin to sign up. Nobody can take its access away. */
export function originalOwner<T extends Pick<User, "id" | "role" | "createdAt">>(users: T[]): T | undefined {
  return users.filter((u) => u.role === "admin").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

export interface UserPatch {
  id: string;
  plan?: PlanId;
  status?: "active" | "suspended";
  role?: "admin" | "user";
  requireApproval?: boolean;
  newPassword?: string;
  resetUsage?: boolean;
  /** Co-owner: admin access and the Unlimited plan in one step (admins never spend credits). */
  makeCoOwner?: boolean;
  /** Employee: unlimited use (no credits spent, Unlimited plan) without admin access; false takes it away. */
  staff?: boolean;
}

export async function adminUpdateUser(actor: User, p: UserPatch) {
  const u = await getUser(p.id);
  if (!u) throw new Error("User not found.");
  if (u.id === actor.id && (p.role === "user" || p.status === "suspended")) throw new Error("You can't remove your own admin access or suspend yourself.");
  if ((p.role === "user" || p.status === "suspended") && originalOwner(await listUsers())?.id === u.id) throw new Error("The owner's access can't be removed.");
  if (p.makeCoOwner) {
    p.role = "admin";
    p.plan = "unlimited";
    p.status = "active";
  }
  const changes: string[] = [];
  if (p.plan && PLANS.some((x) => x.id === p.plan) && p.plan !== u.plan) {
    changes.push(`plan ${u.plan} → ${p.plan}`);
    u.plan = p.plan;
  }
  if (p.status && p.status !== u.status) {
    changes.push(p.status === "suspended" ? "suspended" : "reactivated");
    u.status = p.status;
    if (p.status === "suspended") await destroyAllSessions(u.id);
  }
  if (p.role && p.role !== u.role) {
    changes.push(`role → ${p.role}`);
    u.role = p.role;
  }
  if (typeof p.staff === "boolean" && p.staff !== !!u.staff) {
    changes.push(p.staff ? "made an employee (unlimited use)" : "employee access removed");
    u.staff = p.staff;
    if (p.staff) {
      if (u.plan !== "unlimited") changes.push(`plan ${u.plan} → unlimited`);
      u.plan = "unlimited";
    }
  }
  if (typeof p.requireApproval === "boolean" && p.requireApproval !== u.requireApproval) {
    changes.push(p.requireApproval ? "approval required" : "approval not required");
    u.requireApproval = p.requireApproval;
  }
  if (p.newPassword) {
    const bad = validatePassword(p.newPassword);
    if (bad) throw new Error(bad);
    u.passwordHash = await hashPassword(p.newPassword);
    await destroyAllSessions(u.id);
    changes.push("password reset");
  }
  if (p.resetUsage) {
    u.usage = { ...u.usage, credits: 0, posts: 0 };
    // Also refills the vault: the plan's credits for this cycle are added again the next time the account is used.
    if (u.vault) u.vault.cycle = { key: "", granted: 0 };
    changes.push("usage reset");
  }
  await saveUser(u);
  if (p.makeCoOwner) changes.push("made co-owner");
  if (changes.length) {
    await asUser(actor.id, () => log("info", "system", `Admin updated ${u.email}: ${changes.join(", ")}`));
    await asUser(u.id, () => log("info", "system", `An admin updated your account: ${changes.join(", ")}`));
  }
  return publicUser(u);
}

/** Every user's posts that need attention or are coming up, newest first. */
export async function adminContent(filter: string) {
  const [rows, users] = await Promise.all([allOwners<Post>("posts", 100_000), listUsers()]);
  const emails = new Map(users.map((u) => [u.id, u.email]));
  const wanted = filter === "all" ? null : filter.split(",");
  return rows
    .filter(({ row }) => !wanted || wanted.includes(row.status))
    .map(({ owner, row }) => ({ owner, email: emails.get(owner) ?? "unknown", post: row }))
    .sort((a, b) => (a.post.scheduledAt ?? a.post.createdAt).localeCompare(b.post.scheduledAt ?? b.post.createdAt))
    .slice(0, 500);
}

export interface ReviewAction {
  owner: string;
  postId: string;
  action: "approve" | "reject" | "edit" | "unschedule" | "delete";
  note?: string;
  edit?: Partial<Pick<Post, "hook" | "body" | "parts" | "hashtags" | "cta">>;
}

export async function adminReview(actor: User, a: ReviewAction) {
  return asUser(a.owner, async () => {
    const post = await getPost(a.postId);
    if (!post) throw new Error("Post not found.");
    if (post.status === "published" || post.status === "publishing") throw new Error("That post is already published.");
    const settings = await getSettings();
    if (a.edit) {
      if (typeof a.edit.hook === "string") post.hook = a.edit.hook.trim();
      if (typeof a.edit.body === "string") post.body = a.edit.body.trim();
      if (Array.isArray(a.edit.parts)) post.parts = a.edit.parts.map(String).filter((x) => x.trim());
      if (Array.isArray(a.edit.hashtags)) post.hashtags = a.edit.hashtags.map(String).filter(Boolean);
      if (typeof a.edit.cta === "string") post.cta = a.edit.cta.trim() || undefined;
    }
    if (a.action === "delete") {
      const { deletePost } = await import("./repo");
      await deletePost(post.id);
      await log("warn", "post", `An admin removed your post “${post.hook.slice(0, 60)}”${a.note ? `: ${a.note}` : ""}`, { platform: post.platform });
      return null;
    }
    if (a.action === "approve") {
      if (!post.scheduledAt) throw new Error("This post has no date yet; it can't be approved for publishing.");
      post.status = "scheduled";
      post.reviewNote = a.note || undefined;
    }
    if (a.action === "reject") {
      post.status = "rejected";
      post.reviewNote = a.note || "Please revise and resubmit.";
    }
    if (a.action === "unschedule") {
      post.status = "draft";
      post.reviewNote = a.note || undefined;
    }
    finalizePost(post, settings);
    await savePost(post);
    const verb = { approve: "approved", reject: "sent back", edit: "edited", unschedule: "moved to drafts" }[a.action];
    await log(a.action === "reject" ? "warn" : "info", "post", `An admin ${verb} your post “${post.hook.slice(0, 60)}”${a.note ? `: ${a.note}` : ""}`, { platform: post.platform });
    await asUser(actor.id, () => log("info", "system", `Review: ${verb} a post (${post.platform})`));
    return post;
  });
}

export async function adminStats() {
  const users = await listUsers();
  const posts = await allOwners<Post>("posts", 200_000);
  const month = new Date().toISOString().slice(0, 7);
  const byPlan = Object.fromEntries(PLANS.map((p) => [p.id, 0])) as Record<PlanId, number>;
  let mrr = 0;
  let creditsUsed = 0;
  let vaultCredits = 0;
  const now = Date.now();
  for (const u of users) {
    if (u.vault) vaultCredits += balance(u.vault.lots, now);
    byPlan[u.plan] = (byPlan[u.plan] ?? 0) + 1;
    const plan = planById(u.plan);
    const paying = u.billing?.status ? ["active", "trialing", "past_due"].includes(u.billing.status) : false;
    if (paying) mrr += u.billing?.interval === "year" ? plan.annual : plan.monthly;
    if (u.usage?.period === month) creditsUsed += u.usage.credits;
  }
  return {
    users: users.length,
    active: users.filter((u) => u.status === "active").length,
    newThisMonth: users.filter((u) => u.createdAt.startsWith(month)).length,
    byPlan,
    mrr,
    creditsUsed,
    // An estimate: about 2 cents of Claude usage per credit (measured from the app's prompt sizes; see plans.ts).
    aiCostEstimate: Math.round(creditsUsed * EST_COST_CENTS_PER_CREDIT) / 100,
    /** Credits sitting in vaults right now, and the community pool they expire into. */
    vaultCredits,
    pool: await poolSnapshot(),
    postsPublishedThisMonth: posts.filter(({ row }) => row.status === "published" && (row.publishedAt ?? "").startsWith(month)).length,
    awaitingReview: posts.filter(({ row }) => row.status === "pending_review").length,
  };
}
