// Cost guards: switch render VMs off when idle, and switch everything off when the grant budget hits 90%.
const { app } = require("@azure/functions");
const { queue, workers, vmAction, env } = require("../shared");
const { c } = require("../tenancy");

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
    for (const qn of ["render-work", "render-work-paid", "render-work-free", "render-jobs"]) {
      const props = await queue(qn).getProperties();
      if ((props.approximateMessagesCount || 0) > 0) return;
    }
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { resources } = await c("jobs").items.query({ query: "SELECT VALUE COUNT(1) FROM j WHERE j.status = 'running' AND j.startedAt > @s", parameters: [{ name: "@s", value: since }] }).fetchAll();
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
