"use client";
import { useEffect } from "react";

/**
 * After this server was moved (Admin → Move to a new server), every page sends the visitor to the same page on the
 * new address. Asked once per visit; a server that hasn't moved answers { to: null } and nothing happens.
 */
export function MovedRedirect() {
  useEffect(() => {
    let known: string | null | undefined;
    try {
      known = sessionStorage.getItem("gp_moved_checked") === "none" ? null : undefined;
    } catch {
      /* private window: just ask */
    }
    if (known === null) return;
    fetch("/api/migrate/moved", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { to?: string | null }) => {
        if (j.to && /^https?:\/\//.test(j.to) && new URL(j.to).origin !== location.origin) {
          location.replace(`${j.to.replace(/\/$/, "")}${location.pathname}${location.search}${location.hash}`);
        } else {
          try {
            sessionStorage.setItem("gp_moved_checked", "none");
          } catch {
            /* fine */
          }
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
