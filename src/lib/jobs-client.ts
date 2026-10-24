"use client";
/** Browser side of background jobs: tell the tray to look now, and ask once to send a notification when it's ready. */
export function jobStarted() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    /* notifications not available (e.g. inside the phone app) */
  }
  window.dispatchEvent(new Event("ghostpost:jobs"));
}
