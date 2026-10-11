import "server-only";
import { emailFrom, resendKey } from "./integrations";

/**
 * Transactional email over Resend's HTTPS API (Railway's Hobby plan blocks outbound SMTP, so HTTPS is the reliable route).
 * The admin adds the Resend API key and a From address in Admin → App settings → Integrations.
 */
export async function emailReady() {
  return !!(await resendKey()) && !!(await emailFrom());
}

/** Accepts "you@domain.com" or "Name <you@domain.com>". */
export function validFrom(v: string) {
  const m = v.trim().match(/^(?:([^<>"]{1,80})\s*<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>|([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+))$/);
  return !!m;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }) {
  const [key, from] = await Promise.all([resendKey(), emailFrom()]);
  if (!key || !from) throw new Error("Email isn't set up yet. Add a Resend API key and From address in Admin → App settings → Integrations.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message ?? data.name ?? "send failed"}`);
  return { id: data.id ?? "" };
}

/** A simple branded layout that renders well in Gmail, Outlook and Apple Mail. */
export function emailLayout(opts: { title: string; lines: string[]; button?: { label: string; url: string }; footer?: string }) {
  const body = opts.lines.map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#cbd5e1">${esc(l)}</p>`).join("");
  const button = opts.button
    ? `<p style="margin:22px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#34d399;color:#04110b;font-weight:600;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px">${esc(opts.button.label)}</a></p>`
    : "";
  const footer = opts.footer ? `<p style="margin:26px 0 0;font-size:12px;line-height:1.5;color:#64748b">${esc(opts.footer)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#0b0f17;padding:28px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111827;border:1px solid #1f2937;border-radius:16px">
<tr><td style="padding:28px 28px 8px"><p style="margin:0 0 18px;font-size:14px;font-weight:700;color:#6ee7b7;letter-spacing:.3px">NEXUS PULSE</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#f8fafc">${esc(opts.title)}</h1>${body}${button}${footer}</td></tr>
<tr><td style="padding:0 28px 24px"></td></tr></table></td></tr></table></body></html>`;
}
