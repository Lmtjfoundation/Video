// A render request lands in "render-jobs": tenant checks, prompt enrichment, model choice, then a priority queue.
const { app } = require("@azure/functions");
const { queue, workers, vmAction } = require("../shared");
const { c, config, tenant, monthUsage, activeJobs } = require("../tenancy");
const { enrichPrompt } = require("../enrich");

const log = (ctx, o) => ctx.log("RenderEvent", JSON.stringify(o));

app.storageQueue("renderJobs", {
  queueName: "render-jobs",
  connection: "RenderQueue",
  handler: async (job, ctx) => {
    if (!job || !job.id || !job.kind) throw new Error("A render job needs an id and a kind.");
    const tenantId = job.tenantId || `user-${job.ownerId || "unknown"}`;
    const userId = job.userId || job.ownerId || "unknown";
    const t = await tenant(tenantId, job.plan);
    const plan = (await config(`plan:${t.plan}`)) || (await config("plan:free"));
    const quality = await config("quality");
    const registry = (await config("models")).models;
    const jobs = c("jobs");
    const base = { id: job.id, tenantId, userId, projectId: job.projectId || "none", kind: job.kind, prompt: job.prompt || "", presetId: job.presetId || null, settings: job.settings || {}, plan: t.plan };

    // Monthly motion quota (from the plan in Cosmos).
    const used = await monthUsage(tenantId);
    if (used.motionSeconds + quality.minSeconds > plan.motionSecondsMonth) {
      await jobs.items.upsert({ ...base, status: "rejected", error: `Monthly AI-motion limit reached (${plan.motionSecondsMonth}s on the ${plan.label} plan).`, at: new Date().toISOString() });
      log(ctx, { event: "rejected-quota", renderId: job.id, tenantId, userId, plan: t.plan });
      return;
    }
    // Per-tenant concurrency: over the limit, the job waits its turn (other tenants keep moving).
    if ((await activeJobs(tenantId)) >= plan.concurrency) {
      await jobs.items.upsert({ ...base, status: "waiting", at: new Date().toISOString() });
      await queue("render-jobs").sendMessage(Buffer.from(JSON.stringify({ ...job, tenantId, userId })).toString("base64"), { visibilityTimeout: 60 });
      log(ctx, { event: "deferred-concurrency", renderId: job.id, tenantId, plan: t.plan, limit: plan.concurrency });
      return;
    }

    const speed = job.settings?.speed === true || job.settings?.lowCost === true;
    const prefs = t.modelPreference || (speed ? plan.speedModels : plan.models);
    const models = prefs.filter((m) => registry[m]?.available);
    const enrichedPrompt = enrichPrompt(job.prompt, { seed: job.id, presetMotion: job.presetMotion, grade: job.settings?.grade });
    const dispatched = { ...job, tenantId, userId, plan: t.plan, enrichedPrompt, models, modelRegistry: registry, quality };
    await jobs.items.upsert({ ...base, status: "dispatched", enrichedPrompt, models, queuedAt: new Date().toISOString() });
    log(ctx, { event: "dispatched", renderId: job.id, tenantId, userId, plan: t.plan, priority: plan.priority, models, prompt: job.prompt, enrichedPrompt, settings: job.settings });

    const vms = await workers();
    if (!vms.some((v) => v.power === "running" || v.power === "starting")) {
      const pick = vms.find((v) => v.power === "deallocated" || v.power === "stopped");
      if (pick) await vmAction(pick.name, "start");
    }
    await queue(plan.priority === "paid" ? "render-work-paid" : "render-work-free").sendMessage(Buffer.from(JSON.stringify(dispatched)).toString("base64"));
  },
});
