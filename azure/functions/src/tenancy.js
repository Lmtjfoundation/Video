// Tenancy: plans, quotas, model preferences and usage, all read from Cosmos DB (partition key /tenantId).
// Nothing here is hard-coded: plans live in tenants/_config/plan:<name>, each tenant's settings in tenants/<id>/tenant.
const { credential, env } = require("./shared");
const { CosmosClient } = require("@azure/cosmos");

let db;
const c = (name) => {
  db ??= new CosmosClient({ endpoint: env("COSMOS_ENDPOINT"), aadCredentials: credential }).database(env("COSMOS_DATABASE", "ghostpost"));
  return db.container(name);
};

const cache = new Map();
async function config(id) {
  const hit = cache.get(id);
  if (hit && hit.at > Date.now() - 60_000) return hit.v;
  const { resource } = await c("tenants").item(id, "_config").read();
  cache.set(id, { v: resource, at: Date.now() });
  return resource;
}

/** The tenant's settings, created on first use (plan "free" unless the app sends one). */
async function tenant(tenantId, plan) {
  const t = c("tenants");
  const { resource } = await t.item("tenant", tenantId).read();
  if (resource) return resource;
  const doc = { id: "tenant", tenantId, plan: plan || "free", createdAt: new Date().toISOString(), modelPreference: null, roles: {} };
  await t.items.upsert(doc);
  return doc;
}

const month = () => new Date().toISOString().slice(0, 7);

async function monthUsage(tenantId) {
  const { resource } = await c("usage").item(`month:${month()}`, tenantId).read();
  return resource || { motionSeconds: 0, renders: 0, costUsd: 0, apiCalls: 0 };
}

/** Adds to this month's totals (atomic increments) and keeps one event per render for billing and audit. */
async function recordUsage(tenantId, userId, ev) {
  const u = c("usage");
  const id = `month:${month()}`;
  const ops = [
    { op: "incr", path: "/motionSeconds", value: ev.seconds || 0 },
    { op: "incr", path: "/renders", value: 1 },
    { op: "incr", path: "/costUsd", value: ev.costUsd || 0 },
  ];
  try {
    await u.item(id, tenantId).patch(ops);
  } catch (e) {
    if (e.code !== 404) throw e;
    await u.items.create({ id, tenantId, kind: "month", month: month(), motionSeconds: ev.seconds || 0, renders: 1, costUsd: ev.costUsd || 0, apiCalls: 0 });
  }
  await u.items.create({ id: `ev:${ev.renderId}`, tenantId, userId, kind: "render", at: new Date().toISOString(), ...ev });
}

async function activeJobs(tenantId) {
  const { resources } = await c("jobs").items.query({ query: "SELECT VALUE COUNT(1) FROM j WHERE j.tenantId = @t AND (j.status = 'dispatched' OR j.status = 'running')", parameters: [{ name: "@t", value: tenantId }] }, { partitionKey: tenantId }).fetchAll();
  return resources[0] || 0;
}

module.exports = { c, config, tenant, monthUsage, recordUsage, activeJobs, month };
