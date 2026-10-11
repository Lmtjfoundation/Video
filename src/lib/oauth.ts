import "server-only";
import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import { FB_VERSION, OAUTH } from "./oauth-config";
import { getAppKeys } from "./app-keys";
import { saveFacebookPages } from "./facebook-pages";
import { request } from "./platforms/http";
import type { Credential, Platform } from "./types";

const STATE_TTL_MS = 10 * 60_000;
const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface PendingState {
  id: string;
  platform: Platform;
  verifier?: string;
  redirectUri: string;
  createdAt: number;
}

export function appOrigin(req: Request) {
  const env = process.env.APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  return `${proto}://${host}`;
}

export const redirectUriFor = (origin: string, platform: Platform) => `${origin}/api/connect/${platform}/callback`;

/** Step 1: build the platform's sign-in URL and remember the state (and PKCE verifier) for 10 minutes. */
export async function startAuth(platform: Platform, origin: string) {
  const keys = await getAppKeys(platform);
  if (!keys) throw new Error(`${OAUTH[platform].label} linking isn't set up yet. Open Settings → Accounts and follow the setup steps on the ${OAUTH[platform].label} card.`);
  const p = OAUTH[platform];
  const state = b64url(randomBytes(24));
  const redirectUri = redirectUriFor(origin, platform);
  const pending: PendingState = { id: `oauth_${state}`, platform, redirectUri, createdAt: Date.now() };

  const params = new URLSearchParams({
    [p.clientIdParam]: keys.id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: p.scopes.join(p.scopeSeparator),
    state,
    ...(p.extraAuthParams ?? {}),
  });
  if (p.pkce) {
    pending.verifier = b64url(randomBytes(48));
    params.set("code_challenge", b64url(createHash("sha256").update(pending.verifier).digest()));
    params.set("code_challenge_method", "S256");
  }
  await db().upsert("kv", { id: pending.id, value: pending });
  return `${p.authorizeUrl}?${params.toString()}`;
}

/** Step 2: validate state, exchange the code for tokens, and look up who the account is. */
export async function finishAuth(platform: Platform, code: string, state: string): Promise<Credential> {
  const row = await db().get<{ id: string; value: PendingState }>("kv", `oauth_${state}`);
  await db().remove("kv", `oauth_${state}`); // single use
  const pending = row?.value;
  if (!pending || pending.platform !== platform) throw new Error("This sign-in link is invalid or was already used. Start again from Settings.");
  if (Date.now() - pending.createdAt > STATE_TTL_MS) throw new Error("The sign-in took longer than 10 minutes. Start again from Settings.");

  const p = OAUTH[platform];
  const keys = await getAppKeys(platform);
  if (!keys) throw new Error(`${p.label} app keys were removed. Add them again in Settings → Accounts.`);
  const { id, secret } = keys;
  const form = (o: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const iso = (sec?: number) => (sec ? new Date(Date.now() + sec * 1000).toISOString() : undefined);
  const base = { method: "oauth", scopes: p.scopes.join(" "), connectedAt: new Date().toISOString() };

  switch (platform) {
    case "x": {
      headers.Authorization = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
      const { data } = await request<{ access_token: string; refresh_token?: string; expires_in?: number }>(p.tokenUrl, {
        method: "POST",
        headers,
        body: form({ grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier, client_id: id }),
        label: "X token exchange",
      });
      const me = await request<{ data: { id: string; username: string } }>("https://api.x.com/2/users/me", {
        headers: { Authorization: `Bearer ${data.access_token}` },
        label: "X profile",
      });
      return { ...base, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: iso(data.expires_in), accountId: me.data.data.id, handle: `@${me.data.data.username}` };
    }

    case "facebook": {
      const graph = `https://graph.facebook.com/${FB_VERSION}`;
      const short = await request<{ access_token: string }>(
        `${graph}/oauth/access_token?` + new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: pending.redirectUri, code }),
        { label: "Facebook token exchange" },
      );
      // A long-lived user token makes the Page tokens below long-lived too (they don't expire on a timer).
      const long = await request<{ access_token: string }>(
        `${graph}/oauth/access_token?` + new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: short.data.access_token }),
        { label: "Facebook long-lived token" },
      );
      const acc = await request<{ data?: { id: string; name: string; access_token?: string; tasks?: string[] }[] }>(
        `${graph}/me/accounts?` + new URLSearchParams({ fields: "id,name,access_token,tasks", limit: "100", access_token: long.data.access_token }),
        { label: "Facebook Pages" },
      );
      const pages = (acc.data.data ?? [])
        .filter((pg) => pg.access_token && (!pg.tasks || pg.tasks.includes("CREATE_CONTENT")))
        .map((pg) => ({ id: pg.id, name: pg.name, token: pg.access_token! }));
      if (!pages.length) {
        throw new Error("No Facebook Pages found that you can post to. Apps can only post to Pages you manage, not personal profiles. Create a Page, or ask its admin for full control, then connect again.");
      }
      await saveFacebookPages(pages);
      const first = pages[0];
      return { ...base, accessToken: first.token, accountId: first.id, handle: first.name };
    }

    case "linkedin": {
      const { data } = await request<{ access_token: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number }>(p.tokenUrl, {
        method: "POST",
        headers,
        body: form({ grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, client_id: id, client_secret: secret }),
        label: "LinkedIn token exchange",
      });
      const me = await request<{ sub: string; name?: string }>("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${data.access_token}` },
        label: "LinkedIn profile",
      });
      return {
        ...base,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: iso(data.expires_in),
        refreshExpiresAt: iso(data.refresh_token_expires_in),
        accountId: `urn:li:person:${me.data.sub}`,
        handle: me.data.name || "LinkedIn member",
      };
    }

    case "instagram": {
      const short = await request<{ access_token: string; user_id: string | number }>(p.tokenUrl, {
        method: "POST",
        headers,
        body: form({ client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: pending.redirectUri, code }),
        label: "Instagram token exchange",
      });
      // Swap the short-lived token for a 60-day token (refreshed automatically later).
      const long = await request<{ access_token: string; expires_in: number }>(
        "https://graph.instagram.com/access_token?" + new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret, access_token: short.data.access_token }),
        { label: "Instagram long-lived token" },
      );
      const me = await request<{ user_id?: string; id?: string; username?: string }>(
        "https://graph.instagram.com/me?" + new URLSearchParams({ fields: "user_id,username", access_token: long.data.access_token }),
        { label: "Instagram profile" },
      );
      return {
        ...base,
        accessToken: long.data.access_token,
        expiresAt: iso(long.data.expires_in),
        accountId: String(me.data.user_id ?? short.data.user_id),
        handle: me.data.username ? `@${me.data.username}` : "Instagram account",
      };
    }

    case "youtube": {
      const { data } = await request<{ access_token: string; refresh_token?: string; expires_in?: number }>(p.tokenUrl, {
        method: "POST",
        headers,
        body: form({ grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, client_id: id, client_secret: secret, code_verifier: pending.verifier }),
        label: "Google token exchange",
      });
      const ch = await request<{ items?: { id: string; snippet: { title: string } }[] }>(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${data.access_token}` }, label: "YouTube channel" },
      );
      const channel = ch.data.items?.[0];
      if (!channel) throw new Error("That Google account has no YouTube channel. Create one, then connect again.");
      return { ...base, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: iso(data.expires_in), accountId: channel.id, handle: channel.snippet.title };
    }

    case "tiktok": {
      const { data } = await request<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string; error?: string; error_description?: string }>(p.tokenUrl, {
        method: "POST",
        headers,
        body: form({ client_key: id, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: pending.redirectUri }),
        label: "TikTok token exchange",
      });
      if (data.error) throw new Error(`TikTok: ${data.error_description || data.error}`);
      let handle = "TikTok account";
      try {
        const me = await request<{ data?: { user?: { display_name?: string } } }>("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
          headers: { Authorization: `Bearer ${data.access_token}` },
          label: "TikTok profile",
        });
        handle = me.data.data?.user?.display_name || handle;
      } catch {
        /* profile is optional */
      }
      return { ...base, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: iso(data.expires_in), refreshExpiresAt: iso(data.refresh_expires_in), accountId: data.open_id, handle };
    }
  }
}
