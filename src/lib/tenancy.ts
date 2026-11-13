import "server-only";
import { currentUserId } from "./db";
import type { PlanId } from "./plans";

/**
 * Multi-tenant context. Every account is its own tenant (tenantId "user-<id>") until it joins an organization;
 * all Azure data is partitioned by tenantId (Cosmos partition key /tenantId, Blob paths renders/<tenantId>/<userId>/…),
 * so one tenant can never read or affect another's. Plans, quotas, rate limits and model preferences come from Cosmos
 * (tenants/_config/plan:<name>, tenants/<tenantId>/tenant), never from code.
 */
export type ServicePlan = "free" | "pro" | "studio";
export type Role = "owner" | "editor" | "viewer";

/** The app's billing plan → the service plan its limits are read from. */
export const SERVICE_PLAN: Record<PlanId, ServicePlan> = { free: "free", creator: "pro", pro: "studio", unlimited: "studio" };
export const tenantIdFor = (userId: string) => `user-${userId}`;

interface PlanDoc {
  label: string;
  rpm: number;
  monthlyCalls: number;
  motionSecondsMonth: number;
  concurrency: number;
  priority: "free" | "paid";
}
interface TenantDoc {
  id: "tenant";
  tenantId: string;
  plan: ServicePlan;
  roles?: Record<string, Role>;
}

const planCache = new Map<string, { v: PlanDoc | null; at: number }>();
async function planDoc(plan: ServicePlan): Promise<PlanDoc | null> {
  const hit = planCache.get(plan);
  if (hit && hit.at > Date.now() - 60_000) return hit.v;
  const { cosmos } = await import("./azure-cosmos");
  const { resource } = await (await cosmos("tenants")).item(`plan:${plan}`, "_config").read<PlanDoc>();
  planCache.set(plan, { v: resource ?? null, at: Date.now() });
  return resource ?? null;
}

/** The tenant's record in Cosmos, created on first use and kept in step with the account's plan. The account is owner. */
export async function ensureTenant(userId: string, appPlan: PlanId): Promise<TenantDoc> {
  const { cosmos } = await import("./azure-cosmos");
  const c = await cosmos("tenants");
  const tenantId = tenantIdFor(userId);
  const plan = SERVICE_PLAN[appPlan] ?? "free";
  const { resource } = await c.item("tenant", tenantId).read<TenantDoc>();
  if (resource && resource.plan === plan && resource.roles?.[userId]) return resource;
  const doc: TenantDoc = { ...(resource ?? { id: "tenant", tenantId }), id: "tenant", tenantId, plan, roles: { ...(resource?.roles ?? {}), [userId]: resource?.roles?.[userId] ?? "owner" } };
  await c.items.upsert(doc);
  return doc;
}

export async function roleOf(userId: string, appPlan: PlanId): Promise<Role> {
  return (await ensureTenant(userId, appPlan)).roles?.[userId] ?? "viewer";
}

const limitsCache = new Map<string, { v: { tenantId: string; rpm: number }; at: number }>();
/**
 * Headers API Management uses for per-tenant, per-plan rate limiting (only the app's managed identity can call the
 * gateway, so they're trusted). Also counts the call toward the tenant's monthly API usage. Empty when no user is in
 * context (background jobs) or Cosmos isn't connected.
 */
export async function tenantHeaders(): Promise<Record<string, string>> {
  const uid = currentUserId();
  if (!uid) return {};
  try {
    const { cosmosReady } = await import("./azure-cosmos");
    if (!(await cosmosReady())) return {};
    let hit = limitsCache.get(uid);
    if (!hit || hit.at < Date.now() - 60_000) {
      const { getUser } = await import("./auth");
      const u = await getUser(uid);
      const t = await ensureTenant(uid, u?.plan ?? "free");
      const p = await planDoc(t.plan);
      hit = { v: { tenantId: t.tenantId, rpm: p?.rpm ?? 20 }, at: Date.now() };
      limitsCache.set(uid, hit);
    }
    void countApiCall(hit.v.tenantId);
    return { "x-tenant-id": hit.v.tenantId, "x-tenant-rpm": String(hit.v.rpm) };
  } catch {
    return {};
  }
}

const month = () => new Date().toISOString().slice(0, 7);

async function countApiCall(tenantId: string) {
  try {
    const { cosmos } = await import("./azure-cosmos");
    const c = await cosmos("usage");
    const id = `month:${month()}`;
    try {
      await c.item(id, tenantId).patch([{ op: "incr", path: "/apiCalls", value: 1 }]);
    } catch (e) {
      if ((e as { code?: number }).code !== 404) throw e;
      await c.items.create({ id, tenantId, kind: "month", month: month(), motionSeconds: 0, renders: 0, costUsd: 0, apiCalls: 1 });
    }
  } catch {
    /* usage counting is best effort; the gateway still enforces the rate limit */
  }
}

export interface TenantUsage {
  tenantId: string;
  plan: ServicePlan;
  role: Role;
  month: string;
  used: { motionSeconds: number; renders: number; costUsd: number; apiCalls: number };
  limits: { motionSecondsMonth: number; monthlyCalls: number; rpm: number; concurrency: number; priority: string } | null;
}

/** This month's usage and the plan's limits, for billing and plan enforcement (GET /api/usage). */
export async function tenantUsage(userId: string, appPlan: PlanId): Promise<TenantUsage> {
  const { cosmos } = await import("./azure-cosmos");
  const t = await ensureTenant(userId, appPlan);
  const { resource } = await (await cosmos("usage")).item(`month:${month()}`, t.tenantId).read<TenantUsage["used"]>();
  const p = await planDoc(t.plan);
  return {
    tenantId: t.tenantId,
    plan: t.plan,
    role: t.roles?.[userId] ?? "viewer",
    month: month(),
    used: { motionSeconds: resource?.motionSeconds ?? 0, renders: resource?.renders ?? 0, costUsd: Math.round((resource?.costUsd ?? 0) * 100) / 100, apiCalls: resource?.apiCalls ?? 0 },
    limits: p ? { motionSecondsMonth: p.motionSecondsMonth, monthlyCalls: p.monthlyCalls, rpm: p.rpm, concurrency: p.concurrency, priority: p.priority } : null,
  };
}
