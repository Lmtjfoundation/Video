import { isIP } from "node:net";

/**
 * Safety checks for the "Any app (webhook)" connector.
 * A customer chooses the URL and our server calls it, so it must never reach our own network
 * (localhost, private ranges, cloud metadata addresses). Pure functions, covered by tests.
 */

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** True for IPv4/IPv6 addresses that are loopback, private, link-local, multicast, reserved or otherwise internal. */
export function isPrivateAddress(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(a);
  if (kind === 4) {
    const [p, q] = a.split(".").map(Number);
    return (
      p === 0 || // "this" network
      p === 10 ||
      p === 127 || // loopback
      (p === 100 && q >= 64 && q <= 127) || // carrier-grade NAT
      (p === 169 && q === 254) || // link-local, includes cloud metadata 169.254.169.254
      (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) ||
      (p === 192 && q === 0) ||
      (p === 198 && (q === 18 || q === 19)) || // benchmarking
      p >= 224 // multicast and reserved
    );
  }
  if (kind === 6) {
    if (a === "::" || a === "::1") return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) return true; // other IPv4-mapped forms: refuse
    return /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("ff"); // unique-local, link-local, multicast
  }
  return false;
}

/** Validates the URL text itself (no DNS). Returns an error message, or null when it looks acceptable. */
export function webhookUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "That doesn't look like a web address. Paste the full URL, starting with https://";
  }
  if (u.protocol !== "https:") return "The webhook address must start with https://";
  if (u.username || u.password) return "Remove the username and password from the address; use the signing secret instead.";
  if (u.port && u.port !== "443") return "Only the standard https port (443) is allowed.";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return "Internal or local addresses aren't allowed.";
  if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host)) return "Internal or local addresses aren't allowed.";
  if (!host.includes(".") && !isIP(host.replace(/^\[|\]$/g, ""))) return "Use a full public domain name.";
  if (raw.length > 2000) return "That address is too long.";
  return null;
}
