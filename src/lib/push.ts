import "server-only";
import webpush from "web-push";
import { getUser } from "./auth";
import { gdb } from "./db";
import { emailReady, sendEmail } from "./email";
import { getSettings, kvGet, kvSet } from "./repo";

/**
 * "It's ready" when the app is closed: a web push to each of the person's devices (lock screen, desktop) and, for
 * long jobs, an email. Both are best-effort: a failure here never fails the job.
 */

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const SUBS = "push-subs";
const MAX_DEVICES = 10;

/** VAPID keys: from the environment, else made once and kept in the app's own settings (never in git). */
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const store = gdb();
  const row = await store.get<{ id: string; value: { publicKey: string; privateKey: string } }>("kv", "vapid");
  if (row?.value?.publicKey) return row.value;
  const keys = webpush.generateVAPIDKeys();
  await store.upsert("kv", { id: "vapid", value: keys });
  return keys;
}

export const listSubs = async () => (await kvGet<PushSub[]>(SUBS)) ?? [];

export function validSub(v: unknown): v is PushSub {
  const s = v as PushSub;
  return !!s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";
}

export async function addSub(sub: PushSub) {
  const list = (await listSubs()).filter((s) => s.endpoint !== sub.endpoint);
  await kvSet(SUBS, [{ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, ...list].slice(0, MAX_DEVICES));
}

export async function removeSub(endpoint: string) {
  await kvSet(SUBS, (await listSubs()).filter((s) => s.endpoint !== endpoint));
}

/** The notification a finished job sends. */
export function jobMessage(j: { title: string; status: "done" | "failed"; message: string; href?: string }) {
  const done = j.status === "done";
  return {
    title: done ? "Ready in Curbvue" : "Didn't finish",
    body: (done ? j.message && j.message !== "Ready" ? j.message : `Ready: ${j.title}` : `${j.title}: ${j.message}`).slice(0, 180),
    url: j.href && j.href.startsWith("/") ? j.href : "/",
  };
}

/** Kinds that take long enough to deserve an email as well as a push. */
export const LONG_KINDS = new Set(["movie", "render", "studio", "episode"]);

/** Tell the person (must run as them) that something finished. */
export async function notifyFinished(userId: string, j: { kind: string; title: string; status: "done" | "failed"; message: string; href?: string }) {
  const msg = jobMessage(j);
  const subs = await listSubs();
  if (subs.length) {
    try {
      const { publicKey, privateKey } = await vapidKeys();
      const contact = process.env.SUPPORT_EMAIL ? `mailto:${process.env.SUPPORT_EMAIL}` : (process.env.APP_URL || "https://ghostpost.eastus.cloudapp.azure.com");
      webpush.setVapidDetails(contact, publicKey, privateKey);
      for (const s of subs) {
        try {
          await webpush.sendNotification(s, JSON.stringify(msg), { TTL: 24 * 3600 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await removeSub(s.endpoint); // the device unsubscribed
          else console.warn(`[push] couldn't notify a device: ${(e as Error).message.slice(0, 160)}`);
        }
      }
    } catch (e) {
      console.warn(`[push] ${(e as Error).message.slice(0, 160)}`);
    }
  }
  if (!LONG_KINDS.has(j.kind)) return;
  try {
    if (!(await getSettings()).notifyEmail || !(await emailReady())) return;
    const user = await getUser(userId);
    if (!user?.email) return;
    const base = (process.env.APP_URL || "https://ghostpost.eastus.cloudapp.azure.com").replace(/\/$/, "");
    const link = base + msg.url;
    const safe = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    await sendEmail({
      to: user.email,
      subject: msg.body.slice(0, 120),
      text: `${msg.body}\n\nOpen it: ${link}\n\nTurn these emails off in Settings.`,
      html: `<p>${safe(msg.body)}</p><p><a href="${safe(link)}">Open it in Curbvue</a></p><p style="color:#888;font-size:12px">Turn these emails off in Settings.</p>`,
    });
  } catch (e) {
    console.warn(`[notify] email failed: ${(e as Error).message.slice(0, 160)}`);
  }
}
