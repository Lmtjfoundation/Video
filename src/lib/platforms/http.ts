import "server-only";

export class CopyReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyReadyError";
  }
}
export class RateLimitError extends Error {
  constructor(message: string, public retryAfterSec?: number) {
    super(message);
    this.name = "RateLimitError";
  }
}
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** fetch wrapper that converts platform responses into typed errors. */
export async function request<T = unknown>(url: string, init: RequestInit & { label: string }): Promise<{ data: T; headers: Headers }> {
  const { label, ...rest } = init;
  const res = await fetch(url, { ...rest, cache: "no-store" });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON body */
  }
  if (res.ok) return { data: data as T, headers: res.headers };

  const snippet = typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300);
  if (res.status === 429 || /rate.?limit|too many/i.test(snippet)) {
    const ra = Number(res.headers.get("retry-after") ?? res.headers.get("x-rate-limit-reset"));
    const retryAfter = Number.isFinite(ra) && ra > 0 ? (ra > 1e9 ? Math.max(0, ra - Date.now() / 1000) : ra) : undefined;
    throw new RateLimitError(`${label}: rate limited (${res.status})`, retryAfter);
  }
  if (res.status === 401 || res.status === 403) throw new AuthError(`${label}: ${res.status} ${snippet}`);
  throw new Error(`${label}: ${res.status} ${snippet}`);
}
