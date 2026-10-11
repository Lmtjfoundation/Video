import "server-only";
import { getCredential, log, patchCredential } from "../repo";
import type { Credential, Platform } from "../types";
import { request } from "./http";
import { getAppKeys } from "../app-keys";

const msLeft = (c: Credential) => (c.expiresAt ? new Date(c.expiresAt).getTime() - Date.now() : Infinity);
const expiringSoon = (c: Credential) => msLeft(c) < 5 * 60_000;

/**
 * Returns a usable credential, refreshing OAuth tokens where the platform supports it
 * and the app client credentials are configured (X, YouTube, TikTok, LinkedIn; Instagram refreshes its 60-day token).
 */
export async function freshCredential(platform: Platform): Promise<Credential | null> {
  const cred = await getCredential(platform);
  if (!cred?.accessToken) return null;
  try {
    // Instagram long-lived tokens (60 days) are refreshed with the token itself — no refresh token.
    if (platform === "instagram" && cred.method === "oauth" && msLeft(cred) < 10 * 86400_000 && msLeft(cred) > 0) {
      const { data } = await request<{ access_token: string; expires_in: number }>(
        "https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({ grant_type: "ig_refresh_token", access_token: cred.accessToken }),
        { label: "Instagram token refresh" },
      );
      const next = { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
      await patchCredential("instagram", next);
      return { ...cred, ...next };
    }
    if (!expiringSoon(cred) || !cred.refreshToken) return cred;
    const keys = await getAppKeys(platform);
    if (!keys) return cred;

    if (platform === "x") {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
        client_id: keys.id,
      });
      const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
      if (keys.secret) {
        headers.Authorization =
          "Basic " + Buffer.from(`${keys.id}:${keys.secret}`).toString("base64");
      }
      const { data } = await request<{ access_token: string; refresh_token?: string; expires_in: number }>(
        "https://api.x.com/2/oauth2/token",
        { method: "POST", headers, body, label: "X token refresh" },
      );
      // X rotates refresh tokens — the new one must be saved or the next refresh fails.
      const next = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? cred.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      };
      await patchCredential("x", next);
      return { ...cred, ...next };
    }

    if (platform === "youtube") {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
        client_id: keys.id,
        client_secret: keys.secret,
      });
      const { data } = await request<{ access_token: string; expires_in: number }>("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        label: "Google token refresh",
      });
      const next = { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
      await patchCredential("youtube", next);
      return { ...cred, ...next };
    }
    if (platform === "tiktok") {
      const { data } = await request<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in?: number }>(
        "https://open.tiktokapis.com/v2/oauth/token/",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_key: keys.id, client_secret: keys.secret, grant_type: "refresh_token", refresh_token: cred.refreshToken }),
          label: "TikTok token refresh",
        },
      );
      // TikTok may rotate the refresh token; always keep the newest one.
      const next = { accessToken: data.access_token, refreshToken: data.refresh_token || cred.refreshToken, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
      await patchCredential("tiktok", next);
      return { ...cred, ...next };
    }

    if (platform === "linkedin") {
      // Only apps LinkedIn has enabled for refresh tokens receive one; others must reconnect every 60 days.
      const { data } = await request<{ access_token: string; refresh_token?: string; expires_in: number }>(
        "https://www.linkedin.com/oauth/v2/accessToken",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cred.refreshToken, client_id: keys.id, client_secret: keys.secret }),
          label: "LinkedIn token refresh",
        },
      );
      const next = { accessToken: data.access_token, refreshToken: data.refresh_token || cred.refreshToken, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
      await patchCredential("linkedin", next);
      return { ...cred, ...next };
    }
  } catch (e) {
    await log("error", "system", `Token refresh failed for ${platform}: ${(e as Error).message}`, { platform });
  }
  return cred;
}
