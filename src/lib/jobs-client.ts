"use client";

const b64 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * Ask (once) to notify this device when work finishes, and register it with the server, so the message arrives on
 * the lock screen even with Curbvue closed. Silent where push isn't available (e.g. inside the phone app).
 */
export async function enablePush(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const r = await fetch("/api/push");
      if (!r.ok) return false;
      const { publicKey } = (await r.json()) as { publicKey: string };
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
    }
    const save = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    return save.ok;
  } catch {
    return false;
  }
}

/** Browser side of background jobs: tell the tray to look now, and make sure this device hears when it's ready. */
export function jobStarted() {
  void enablePush();
  window.dispatchEvent(new Event("ghostpost:jobs"));
}
