"use client";

/** The hosting proxy answers 502/504 (with a web page, not JSON) while the server restarts or a request runs too long. */
const GATEWAY = new Set([502, 504]);

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body ? "POST" : "GET");
  const send = () =>
    fetch(path, {
      method,
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  let res = await send();
  // Reads are safe to repeat: wait out a restart (up to about 10 s) before showing an error.
  for (let i = 0; method === "GET" && GATEWAY.has(res.status) && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    res = await send();
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error("Please sign in.");
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data ? (data as { error: string }).error : null) ??
      (GATEWAY.has(res.status) || res.status === 503
        ? "Ghost Post is restarting or busy for a moment. Please try again in a minute; anything already started keeps running."
        : `Request failed (${res.status})`);
    throw new Error(msg);
  }
  return data as T;
}

/** "Make an explainer video" on the Explain page hands its text to Movie Studio through sessionStorage. */
export const EXPLAIN_HANDOFF = "ghostpost:explain-to-video";
/** "Open in Movie Studio" in the Writers' Room hands the film's story and cast over the same way. */
export const FILM_HANDOFF = "ghostpost:film-to-movie";

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function fmtDateTime(iso: string | undefined, tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtTime(iso: string | undefined, tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
