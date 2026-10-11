/**
 * Built-in scheduler for always-on servers (Railway, Render, a VPS, Docker).
 * Set INTERNAL_SCHEDULER=1 and the server calls its own cron endpoints:
 * publishing every 5 minutes, engagement every 15. Leave it off on Vercel (vercel.json crons do this there).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.INTERNAL_SCHEDULER !== "1") return;
  const g = globalThis as unknown as { __nexusScheduler?: boolean };
  if (g.__nexusScheduler) return;
  g.__nexusScheduler = true;

  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const headers = { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` };
  const minutes = Math.max(1, Number(process.env.SCHEDULER_INTERVAL_MINUTES || 5));
  let tick = 0;

  const hit = async (path: string) => {
    try {
      const res = await fetch(base + path, { headers });
      if (!res.ok) console.error(`[scheduler] ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      console.error(`[scheduler] ${path} failed:`, (err as Error).message);
    }
  };

  const loop = async () => {
    await hit("/api/cron/publish");
    if (tick++ % 3 === 0) await hit("/api/cron/engage");
  };

  console.log(`[scheduler] built-in scheduler on: publishing every ${minutes} min`);
  setTimeout(loop, 30_000); // let the server finish starting
  setInterval(loop, minutes * 60_000);
}
