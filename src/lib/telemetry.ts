import "server-only";
import { azureToken } from "./azure-identity";
import { pick } from "./integrations";

/**
 * Render and generation events to Azure Monitor (Application Insights), sent with the managed identity (the resource
 * has key-based ingestion switched off). Each event carries the prompt and settings, so an output can be traced back
 * to what made it, and a bad preset rolled back. Never throws: telemetry must not break a job.
 */
export async function trackEvent(name: string, props: Record<string, unknown>) {
  try {
    const conn = await pick("azureInsightsConnection", "APPLICATIONINSIGHTS_CONNECTION_STRING");
    const ikey = conn.match(/InstrumentationKey=([^;]+)/)?.[1];
    const ingest = (conn.match(/IngestionEndpoint=([^;]+)/)?.[1] ?? "").replace(/\/+$/, "");
    if (!ikey || !ingest) return;
    const properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 8000) : JSON.stringify(v)?.slice(0, 8000) ?? ""]));
    const body = [{ name: "Microsoft.ApplicationInsights.Event", time: new Date().toISOString(), iKey: ikey, tags: { "ai.cloud.role": "ghost-post-app" }, data: { baseType: "EventData", baseData: { ver: 2, name, properties } } }];
    await fetch(`${ingest}/v2.1/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await azureToken("https://monitor.azure.com/.default")}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* telemetry is best effort */
  }
}
