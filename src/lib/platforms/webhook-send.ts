import "server-only";
import { createHmac } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isPrivateAddress, webhookUrlProblem } from "./webhook-guard";
import { AuthError, RateLimitError } from "./http";

export interface WebhookResult {
  status: number;
  body: string;
}

/**
 * POSTs JSON to a customer-chosen https URL.
 * - The URL is validated, and every address the hostname resolves to is checked at connection time
 *   (so DNS tricks can't point it at an internal address).
 * - Redirects are never followed. 10 s timeout. Response body capped at 64 KB.
 * - With a signing secret, the request carries `X-Nexus-Signature: sha256=<hex HMAC of the body>`
 *   and `X-Nexus-Timestamp`, so the receiver can verify it came from this app.
 */
export function postWebhook(rawUrl: string, payload: unknown, secret?: string): Promise<WebhookResult> {
  const problem = webhookUrlProblem(rawUrl);
  if (problem) return Promise.reject(new Error(`Webhook address rejected: ${problem}`));
  const url = new URL(rawUrl.trim());
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
    "User-Agent": "NexusPulse-Webhook/1.0",
    "X-Nexus-Timestamp": timestamp,
  };
  if (secret) headers["X-Nexus-Signature"] = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: "POST",
        headers,
        timeout: 10_000,
        // Runs for every connection: refuse any private/internal address.
        lookup: (host, options, cb) => {
          dnsLookup(host, { ...options, all: true }, (err, addresses) => {
            if (err) return (cb as (e: Error | null) => void)(err);
            const list = addresses as LookupAddress[];
            const bad = list.find((a) => isPrivateAddress(a.address));
            if (bad || !list.length) return (cb as (e: Error | null) => void)(new Error("The webhook address resolves to an internal network address, so it was blocked."));
            const ok = list[0];
            if (options.all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
            (cb as unknown as (e: null, a: string, f: number) => void)(null, ok.address, ok.family);
          });
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= 64 * 1024) chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return resolve({ status, body: text });
          const snippet = text.replace(/\s+/g, " ").slice(0, 200);
          if (status === 429) return reject(new RateLimitError("Webhook receiver rate limited (429)", Number(res.headers["retry-after"]) || undefined));
          if (status === 401 || status === 403) return reject(new AuthError(`Webhook receiver refused the request (${status}). Check the URL or secret.`));
          if (status >= 300 && status < 400) return reject(new Error(`Webhook receiver redirected (${status}); redirects aren't followed. Use the final URL.`));
          reject(new Error(`Webhook receiver returned ${status}${snippet ? `: ${snippet}` : ""}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook receiver didn't answer within 10 seconds.")));
    req.on("error", reject);
    req.end(body);
  });
}
