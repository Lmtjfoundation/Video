// Workers report on "render-done": job status, usage (per tenant, for billing and plan enforcement) and telemetry.
const { app } = require("@azure/functions");
const { env } = require("../shared");
const { c, recordUsage } = require("../tenancy");

app.storageQueue("renderDone", {
  queueName: "render-done",
  connection: "RenderQueue",
  handler: async (msg, ctx) => {
    const tenantId = msg.tenantId || "default";
    const jobs = c("jobs");
    const { resource: doc } = await jobs.item(msg.id, tenantId).read();
    if (!doc) throw new Error(`Unknown render ${msg.id} for tenant ${tenantId}`);
    if (msg.running) {
      Object.assign(doc, { status: "running", worker: msg.worker, startedAt: new Date().toISOString() });
      await jobs.items.upsert(doc);
      return;
    }
    const cdn = env("CDN_BASE");
    Object.assign(doc, {
      status: msg.ok ? "done" : "failed",
      error: msg.ok ? null : String(msg.error || "unknown error").slice(0, 1000),
      blob: msg.blob || null,
      hls: msg.hls || null,
      url: msg.ok && msg.blob && cdn ? `${cdn}/${msg.blob}` : null,
      model: msg.model || null,
      seconds: msg.seconds ?? null,
      wallSeconds: msg.wallSeconds ?? null,
      costUsd: msg.costUsd ?? null,
      motionScore: msg.motionScore ?? null,
      attempts: msg.attempts || [],
      worker: msg.worker || null,
      finishedAt: new Date().toISOString(),
    });
    await jobs.items.upsert(doc);
    if (msg.ok) await recordUsage(tenantId, doc.userId, { renderId: doc.id, seconds: msg.seconds || 0, model: msg.model, costUsd: msg.costUsd || 0, wallSeconds: msg.wallSeconds, attempts: (msg.attempts || []).length });
    ctx.log("RenderEvent", JSON.stringify({ event: doc.status, renderId: doc.id, tenantId, userId: doc.userId, plan: doc.plan, model: doc.model, prompt: doc.prompt, enrichedPrompt: doc.enrichedPrompt, seconds: doc.seconds, costUsd: doc.costUsd, motionScore: doc.motionScore, attempts: doc.attempts.length, error: doc.error }));
  },
});
