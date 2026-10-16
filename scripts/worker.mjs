// Self-hosted scheduler loop. Calls the cron endpoints on an interval.
// Usage:  APP_URL=http://localhost:3000 CRON_SECRET=... npm run worker
const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET || "";
const minutes = Math.max(1, Number(process.env.WORKER_INTERVAL_MINUTES || 5));
let tick = 0;

async function hit(path) {
  const started = Date.now();
  try {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${secret}` } });
    const body = await res.text();
    console.log(`[${new Date().toISOString()}] ${path} → ${res.status} (${Date.now() - started}ms) ${body.slice(0, 300)}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${path} failed:`, err.message);
  }
}

async function loop() {
  // Trend Autopilot every 6th tick (≈30 min); each account runs at most every 2 hours.
  if (tick % 6 === 0) await hit("/api/cron/trends");
  await hit("/api/cron/publish");
  // Engagement runs every 3rd tick (≈15 min at the default interval) to stay gentle on APIs.
  if (tick % 3 === 0) await hit("/api/cron/engage");
  tick++;
}

console.log(`Ghost Post worker → ${base} every ${minutes} min`);
loop();
setInterval(loop, minutes * 60_000);
