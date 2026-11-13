// A worker reports a finished (or failed) render on "render-done".
const { app } = require("@azure/functions");
const { renders, env } = require("../shared");

app.storageQueue("renderDone", {
  queueName: "render-done",
  connection: "RenderQueue",
  handler: async (msg, ctx) => {
    const c = renders();
    const { resource: doc } = await c.item(msg.id, msg.projectId || "none").read();
    if (!doc) throw new Error(`Unknown render ${msg.id}`);
    if (msg.running) {
      Object.assign(doc, { status: "running", worker: msg.worker || null, startedAt: new Date().toISOString() });
      await c.items.upsert(doc);
      ctx.log("RenderEvent", JSON.stringify({ event: "running", renderId: doc.id, projectId: doc.projectId, worker: doc.worker }));
      return;
    }
    const cdn = env("CDN_BASE");
    Object.assign(doc, {
      status: msg.ok ? "done" : "failed",
      error: msg.ok ? null : String(msg.error || "unknown error").slice(0, 1000),
      blob: msg.blob || null,
      url: msg.ok && msg.blob && cdn ? `${cdn}/${msg.blob}` : null,
      worker: msg.worker || null,
      seconds: msg.seconds ?? null,
      finishedAt: new Date().toISOString(),
    });
    await c.items.upsert(doc);
    ctx.log("RenderEvent", JSON.stringify({ event: doc.status, renderId: doc.id, projectId: doc.projectId, kind: doc.kind, prompt: doc.prompt, settings: doc.settings, url: doc.url, seconds: doc.seconds, error: doc.error }));
  },
});
