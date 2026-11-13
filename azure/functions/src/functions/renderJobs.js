// A render request lands in "render-jobs": record it, make sure a render VM is on, hand it to the workers.
const { app } = require("@azure/functions");
const { renders, queue, workers, vmAction } = require("../shared");

app.storageQueue("renderJobs", {
  queueName: "render-jobs",
  connection: "RenderQueue",
  handler: async (job, ctx) => {
    if (!job || !job.id || !job.kind) throw new Error("A render job needs an id and a kind.");
    const doc = {
      id: job.id,
      projectId: job.projectId || "none",
      ownerId: job.ownerId || "unknown",
      kind: job.kind,
      prompt: job.prompt || "",
      settings: job.settings || {},
      presetId: job.presetId || null,
      status: "queued",
      queuedAt: new Date().toISOString(),
    };
    await renders().items.upsert(doc);
    // Structured log line: Application Insights keeps these properties, so each output can be traced to its prompt and settings.
    ctx.log("RenderEvent", JSON.stringify({ event: "queued", renderId: doc.id, projectId: doc.projectId, kind: doc.kind, prompt: doc.prompt, settings: doc.settings, presetId: doc.presetId }));

    const vms = await workers();
    if (!vms.some((v) => v.power === "running" || v.power === "starting")) {
      const pick = vms.find((v) => v.power === "deallocated" || v.power === "stopped");
      if (pick) {
        await vmAction(pick.name, "start");
        ctx.log("RenderEvent", JSON.stringify({ event: "worker-starting", renderId: doc.id, vm: pick.name }));
      } else {
        ctx.warn("No render worker VM is tagged role=render-worker; the job waits in render-work.");
      }
    }
    await queue("render-work").sendMessage(Buffer.from(JSON.stringify(job)).toString("base64"));
  },
});
