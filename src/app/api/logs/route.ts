import { authed, ok } from "@/lib/http-api";
import { listLogs } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = authed(async (req: Request) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const level = url.searchParams.get("level");
  const q = url.searchParams.get("q")?.toLowerCase();
  let logs = await listLogs(2000);
  if (kind) logs = logs.filter((l) => l.kind === kind);
  if (level) logs = logs.filter((l) => l.level === level);
  if (q) logs = logs.filter((l) => l.message.toLowerCase().includes(q) || JSON.stringify(l.meta ?? {}).toLowerCase().includes(q));
  return ok(logs.slice(0, 500));
});
