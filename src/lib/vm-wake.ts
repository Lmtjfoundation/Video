import "server-only";

/**
 * Wake on use: when the engine's machine is switched off (it shuts down at night to save money), Vueio starts it
 * through the Azure API and waits for the engine to answer. It uses a service principal that may only read and start
 * that one VM. Settings: one line in Admin → Integrations (or VM_WAKE), e.g.
 *   tenant=…;client=…;secret=…;subscription=…;group=GHOSTPOST;vm=Ghost
 * When Vueio itself runs on an Azure VM, its managed identity can do it instead, with no secret to store:
 *   identity=1;subscription=…;group=GHOSTPOST;vm=Ghost
 * (give the app VM's identity "Virtual Machine Contributor" on the engine VM).
 * An engine on AWS (or anywhere else) can instead have a wake link: a web address that starts its machine when it gets
 * a POST with the token in the x-wake-token header (e.g. the WakeUrl Lambda of the AWS GPU stack):
 *   url=https://….lambda-url.us-east-1.on.aws/;token=…
 */
export interface WakeSettings {
  /** Empty when the app VM's managed identity is used. */
  tenant: string;
  client: string;
  secret: string;
  identity?: boolean;
  subscription: string;
  group: string;
  vm: string;
  /** Wake link (AWS): POST here with x-wake-token. Set instead of the Azure fields. */
  url?: string;
  token?: string;
}

const KEYS = ["tenant", "client", "secret", "subscription", "group", "vm"] as const;

/** Reads the settings line; null when it's empty or any part is missing or malformed. */
export function parseWake(line: string | undefined | null): WakeSettings | null {
  if (!line?.trim()) return null;
  const parts = Object.fromEntries(
    line
      .split(";")
      .map((p) => p.split("="))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k.trim().toLowerCase(), v.join("=").trim()]),
  );
  if (parts.url || parts.token) {
    let u: URL | null = null;
    try {
      u = new URL(parts.url ?? "");
    } catch {
      u = null;
    }
    const ok = !!u && u.protocol === "https:" && /^[A-Za-z0-9_.~-]{12,200}$/.test(parts.token ?? "");
    return ok ? { tenant: "", client: "", secret: "", subscription: "", group: "", vm: u!.hostname.split(".")[0], url: u!.toString(), token: parts.token } : null;
  }
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const target = guid.test(parts.subscription ?? "") && /^[A-Za-z0-9._()-]{1,90}$/.test(parts.group ?? "") && /^[A-Za-z0-9._-]{1,64}$/.test(parts.vm ?? "");
  if (/^(1|true|yes)$/i.test(parts.identity ?? "")) {
    return target ? { tenant: "", client: "", secret: "", identity: true, subscription: parts.subscription, group: parts.group, vm: parts.vm } : null;
  }
  const ok =
    guid.test(parts.tenant ?? "") &&
    guid.test(parts.client ?? "") &&
    guid.test(parts.subscription ?? "") &&
    /^.{8,200}$/.test(parts.secret ?? "") &&
    /^[A-Za-z0-9._()-]{1,90}$/.test(parts.group ?? "") &&
    /^[A-Za-z0-9._-]{1,64}$/.test(parts.vm ?? "");
  return ok ? (Object.fromEntries(KEYS.map((k) => [k, parts[k]])) as unknown as WakeSettings) : null;
}

/** Which engine machine: "main" (the first engine) or "gpu" (the GPU engine). Each has its own wake line. */
export type WakeKind = "main" | "gpu";

async function wakeLine(kind: WakeKind) {
  const { vmWake, vmWakeGpu } = await import("./integrations");
  return parseWake(await (kind === "gpu" ? vmWakeGpu() : vmWake()));
}
export const wakeConfigured = async (kind: WakeKind = "main") => !!(await wakeLine(kind));

/** Whether the engine at `url` answers its health check within 8 seconds. */
export const engineHealthy = async (url: string) => {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    return res.ok && ((await res.json().catch(() => null)) as { ok?: boolean } | null)?.ok === true;
  } catch {
    return false;
  }
};

const starting = new Map<WakeKind, Promise<void>>();

/**
 * Starts the VM (if wake is set up) and waits until the engine at `url` answers, up to `waitMs`. One start at a
 * time: requests that arrive meanwhile wait for the same one. Throws with a plain reason when it can't.
 */
export function wakeEngine(url: string, o: { waitMs?: number; pollMs?: number; kind?: WakeKind } = {}): Promise<void> {
  const kind = o.kind ?? "main";
  const running = starting.get(kind);
  if (running) return running;
  const p = (async () => {
    try {
      const w = await wakeLine(kind);
      if (!w) throw new Error("The engine's machine is off and wake on use isn't set up (Admin → Integrations → Wake the engine's VM).");
      if (w.url) {
        // Wake link (AWS): it starts the machine and answers with its state; the engine is polled below.
        const res = await fetch(w.url, { method: "POST", headers: { "x-wake-token": w.token ?? "" }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!res?.ok)
          throw new Error(
            res?.status === 401
              ? "The engine's wake link refused the token. Check the wake line in Admin → Integrations."
              : res?.status === 403
                ? "AWS refused the engine's wake link (HTTP 403): its Lambda function needs both the lambda:InvokeFunctionUrl and lambda:InvokeFunction permissions."
                : `The engine's wake link didn't start the machine (${res ? `HTTP ${res.status}` : "no answer"}).`,
          );
      } else {
        const tok = w.identity
          ? // The app VM's own identity, from Azure's instance metadata service (reachable only from inside the VM).
            await fetch("http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmanagement.azure.com%2F", { headers: { Metadata: "true" }, signal: AbortSignal.timeout(10_000) }).catch(() => null)
          : await fetch(`https://login.microsoftonline.com/${w.tenant}/oauth2/v2.0/token`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ grant_type: "client_credentials", client_id: w.client, client_secret: w.secret, scope: "https://management.azure.com/.default" }),
            });
        if (!tok?.ok) throw new Error(w.identity ? `This server's Azure identity couldn't sign in (${tok ? `HTTP ${tok.status}` : "no answer"}). Turn on its system-assigned identity in Azure.` : `Azure refused the wake credentials (HTTP ${tok?.status}). Check the line in Admin → Integrations.`);
        const { access_token } = (await tok.json()) as { access_token: string };
        const start = await fetch(`https://management.azure.com/subscriptions/${w.subscription}/resourceGroups/${w.group}/providers/Microsoft.Compute/virtualMachines/${w.vm}/start?api-version=2024-07-01`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!start.ok && start.status !== 202) throw new Error(`Azure couldn't start the VM “${w.vm}” (HTTP ${start.status}).`);
      }
      console.info(`[vm-wake] starting ${w.vm}`);
      const deadline = Date.now() + (o.waitMs ?? 5 * 60_000);
      while (Date.now() < deadline) {
        if (await engineHealthy(url)) return;
        await new Promise((r) => setTimeout(r, o.pollMs ?? 5_000));
      }
      throw new Error(`The VM “${w.vm}” was started but the engine didn't answer within ${Math.round((o.waitMs ?? 300_000) / 60_000)} minutes. Try again in a minute.`);
    } finally {
      starting.delete(kind);
    }
  })();
  starting.set(kind, p);
  return p;
}

let lastEarly = 0;
/**
 * A task just started (a background job or a render): start the engine's machines now, without waiting, so a GPU that
 * stopped itself while idle is booting while the task writes its script and voice instead of when it first needs the
 * engine. Each engine with wake on use is checked; one that already answers is left alone. At most once a minute,
 * and it never throws (the task's own engine calls still wake and wait as before).
 */
export function wakeForTask(): void {
  if (Date.now() - lastEarly < 60_000) return;
  lastEarly = Date.now();
  void (async () => {
    const { videoEngineGpuUrl, videoEngineUrl } = await import("./integrations");
    const seen = new Set<string>();
    for (const [kind, url] of [["gpu", await videoEngineGpuUrl()], ["main", await videoEngineUrl()]] as const) {
      const u = (url ?? "").trim().replace(/\/+$/, "");
      if (!u || seen.has(u) || !(await wakeConfigured(kind))) continue;
      seen.add(u);
      if (await engineHealthy(u)) continue;
      await wakeEngine(u, { kind, waitMs: 15 * 60_000 }).catch((e) => console.warn(`[vm-wake] early wake for a task: ${(e as Error).message.slice(0, 200)}`));
    }
  })().catch(() => {});
}
