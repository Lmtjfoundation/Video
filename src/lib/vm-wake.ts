import "server-only";

/**
 * Wake on use: when the engine's machine is switched off (it shuts down at night to save money), Ghost Post starts it
 * through the Azure API and waits for the engine to answer. It uses a service principal that may only read and start
 * that one VM. Settings: one line in Admin → Integrations (or VM_WAKE), e.g.
 *   tenant=…;client=…;secret=…;subscription=…;group=GHOSTPOST;vm=Ghost
 */
export interface WakeSettings {
  tenant: string;
  client: string;
  secret: string;
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
  const ok =
    guid.test(parts.tenant ?? "") &&
    guid.test(parts.client ?? "") &&
    guid.test(parts.subscription ?? "") &&
    /^.{8,200}$/.test(parts.secret ?? "") &&
    /^[A-Za-z0-9._()-]{1,90}$/.test(parts.group ?? "") &&
    /^[A-Za-z0-9._-]{1,64}$/.test(parts.vm ?? "");
  return ok ? (Object.fromEntries(KEYS.map((k) => [k, parts[k]])) as unknown as WakeSettings) : null;
}

async function wakeLine() {
  const { vmWake } = await import("./integrations");
  return parseWake(await vmWake());
}
export const wakeConfigured = async () => !!(await wakeLine());

const healthy = async (url: string) => {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(8_000), cache: "no-store" })).ok;
  } catch {
    return false;
  }
};

let starting: Promise<void> | null = null;

/**
 * Starts the VM (if wake is set up) and waits until the engine at `url` answers, up to `waitMs`. One start at a
 * time: requests that arrive meanwhile wait for the same one. Throws with a plain reason when it can't.
 */
export function wakeEngine(url: string, o: { waitMs?: number; pollMs?: number } = {}): Promise<void> {
  starting ??= (async () => {
    try {
      const w = await wakeLine();
      if (!w) throw new Error("The engine's machine is off and wake on use isn't set up (Admin → Integrations → Wake the engine's VM).");
      const tok = await fetch(`https://login.microsoftonline.com/${w.tenant}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: w.client, client_secret: w.secret, scope: "https://management.azure.com/.default" }),
      });
      if (!tok.ok) throw new Error(`Azure refused the wake credentials (HTTP ${tok.status}). Check the line in Admin → Integrations.`);
      const { access_token } = (await tok.json()) as { access_token: string };
      const start = await fetch(`https://management.azure.com/subscriptions/${w.subscription}/resourceGroups/${w.group}/providers/Microsoft.Compute/virtualMachines/${w.vm}/start?api-version=2024-07-01`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!start.ok && start.status !== 202) throw new Error(`Azure couldn't start the VM “${w.vm}” (HTTP ${start.status}).`);
      console.info(`[vm-wake] starting ${w.vm}`);
      const deadline = Date.now() + (o.waitMs ?? 5 * 60_000);
      while (Date.now() < deadline) {
        if (await healthy(url)) return;
        await new Promise((r) => setTimeout(r, o.pollMs ?? 5_000));
      }
      throw new Error(`The VM “${w.vm}” was started but the engine didn't answer within ${Math.round((o.waitMs ?? 300_000) / 60_000)} minutes. Try again in a minute.`);
    } finally {
      starting = null;
    }
  })();
  return starting;
}
