import { authed, body, fail, ok } from "@/lib/http-api";
import { refundCredits, spendCredits } from "@/lib/auth";
import { FLOW_TEMPLATES } from "@/lib/flow-types";
import { cleanFlow, deleteFlow, flowCredits, listFlows, runFlow, saveFlow } from "@/lib/flows";
import { startJob } from "@/lib/jobs";
import { ownEngineReady } from "@/lib/own-video";
import { log } from "@/lib/repo";
import type { Flow } from "@/lib/flow-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = authed(async () => {
  const flows = await listFlows();
  return ok({
    flows: flows.map((f) => ({ ...f, credits: flowCredits(f) })),
    templates: FLOW_TEMPLATES.map((t) => ({ ...t, credits: flowCredits(t) })),
    engine: await ownEngineReady(),
  });
});

/** Save, delete or run a flow. A run takes the credits for every step now and gives back those of steps it didn't reach. */
export const POST = authed(async (req, user) => {
  const b = await body<{ action?: string; flow?: Partial<Flow>; id?: string; idea?: string }>(req);
  if (b.action === "save") return ok({ flow: await saveFlow(b.flow ?? {}) });
  if (b.action === "delete") {
    await deleteFlow(String(b.id ?? ""));
    return ok({ ok: true });
  }
  if (b.action !== "run") return fail("Unknown action.");
  const flow = b.id ? (await listFlows()).find((f) => f.id === b.id) : cleanFlow({ ...b.flow, name: b.flow?.name || "Flow" });
  if (!flow) return fail("That flow wasn't found.", 404);
  const idea = String(b.idea ?? "").trim();
  if (!idea) return fail("Type the idea to run the flow with.");
  if (!(await ownEngineReady())) return fail("Flows run on Ghost Post's engine. The admin connects it in Admin → App settings → Integrations.", 503);
  const credits = flowCredits(flow, idea.length);
  await spendCredits(user.id, credits);
  const job = await startJob(user.id, { kind: "flow", title: `${flow.name}: ${idea.slice(0, 60)}` }, async () => {
    let reached = -1;
    try {
      const r = await runFlow(user.id, flow, idea, (i) => (reached = i));
      await log("info", "generate", `Flow ${flow.name} finished (${r.outputs.length} steps)`);
      return { href: r.final ? "/media" : "/library?shelf=mine", message: r.final ? `Finished: ${r.final.name}` : `${r.outputs.length} steps done` };
    } catch (e) {
      // Give back what the steps that didn't finish would have cost.
      const left = flowCredits({ ...flow, steps: flow.steps.slice(Math.max(0, reached)) }, idea.length);
      await refundCredits(user.id, left);
      throw e;
    }
  });
  return ok({ job, credits });
});
