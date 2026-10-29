import "server-only";

/**
 * Wake on use: when the engine's machine is switched off (it shuts down at night to save money), Ghost Post starts it
 * through the Azure API and waits for the engine to answer. It uses a service principal that may only read and start
 * that one VM. Settings: one line in Admin → Integrations (or VM_WAKE), e.g.
 *   tenant=…;client=…;secret=…;subscription=…;group=GHOSTPOST;vm=Ghost
 * When Ghost Post itself runs on an Azure VM, its managed identity can do it instead, with no secret to store:
 *   identity=1;subscription=…;group=GHOSTPOST;vm=Ghost
 * (give the app VM's identity "Virtual Machine Contributor" on the engine VM).
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
