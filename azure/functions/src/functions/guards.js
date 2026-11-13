// Cost guards: switch render VMs off when idle, and switch everything off when the grant budget hits 90%.
const { app } = require("@azure/functions");
const { renders, queue, workers, vmAction, env } = require("../shared");

async function deallocateAll(ctx, why) {
  const vms = await workers();
  const on = vms.filter((v) => v.power === "running" || v.power === "starting");
  await Promise.all(on.map((v) => vmAction(v.name, "deallocate")));
  ctx.log("RenderEvent", JSON.stringify({ event: "workers-deallocated", why, vms: on.map((v) => v.name) }));
  return on.map((v) => v.name);
}

app.timer("idleGuard", {
  schedule: "0 */20 * * * *",
  handler: async (_t, ctx) => {
    if (env("IDLE_GUARD", "on") !== "on") return;
    const props = await queue("render-work").getProperties();
    if ((props.approximateMessagesCount || 0) > 0) return;
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { resources } = await renders().items.query({ query: "SELECT VALUE COUNT(1) FROM r WHERE r.status = 'running' AND r.startedAt > @s", parameters: [{ name: "@s", value: since }] }).fetchAll();
    if ((resources[0] || 0) > 0) return;
    await deallocateAll(ctx, "idle");
  },
});

app.http("budgetGuard", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req, ctx) => {
    const off = await deallocateAll(ctx, "budget-90-percent");
    return { jsonBody: { deallocated: off } };
  },
});
