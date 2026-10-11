import type { Platform } from "./types";

/**
 * One-click account linking ("Connect with X") per platform.
 * Each platform needs an app registered in its developer portal, with this redirect URL:
 *   {APP_URL}/api/connect/{platform}/callback
 */
export interface OAuthProvider {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: " " | ",";
  /** Name of the client-id query parameter (TikTok calls it client_key). */
  clientIdParam: "client_id" | "client_key";
  pkce: boolean;
  env: { id: string; secret: string };
  extraAuthParams?: Record<string, string>;
  portal: string;
  /** What the user is asked to approve, in plain words. */
  permissions: string[];
}

export const FB_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v25.0";

export const OAUTH: Record<Platform, OAuthProvider> = {
  x: {
    label: "X",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    scopeSeparator: " ",
    clientIdParam: "client_id",
    pkce: true,
    env: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },
    portal: "https://developer.x.com/en/portal/dashboard",
    permissions: ["Read your profile", "Read and publish posts", "Stay connected (refresh token)"],
  },
  facebook: {
    label: "Facebook",
    authorizeUrl: `https://www.facebook.com/${FB_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${FB_VERSION}/oauth/access_token`,
    scopes: ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_posts", "pages_manage_engagement"],
    scopeSeparator: ",",
    clientIdParam: "client_id",
    pkce: false,
    env: { id: "FACEBOOK_APP_ID", secret: "FACEBOOK_APP_SECRET" },
    portal: "https://developers.facebook.com/apps",
    permissions: ["See the Pages you manage", "Publish posts as your Page", "Read and reply to comments on your Page"],
  },
  linkedin: {
    label: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    scopeSeparator: " ",
    clientIdParam: "client_id",
    pkce: false,
    env: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
    portal: "https://www.linkedin.com/developers/apps",
    permissions: ["Read your name and profile photo", "Publish posts on your behalf"],
  },
  instagram: {
    label: "Instagram",
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopes: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments"],
    scopeSeparator: ",",
    clientIdParam: "client_id",
    pkce: false,
    env: { id: "INSTAGRAM_APP_ID", secret: "INSTAGRAM_APP_SECRET" },
    portal: "https://developers.facebook.com/apps",
    permissions: ["Read your professional account profile", "Publish posts", "Read and reply to comments"],
  },
  youtube: {
    label: "YouTube",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
    scopeSeparator: " ",
    clientIdParam: "client_id",
    pkce: true,
    env: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
    // offline + consent are needed for Google to return a refresh token.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    portal: "https://console.cloud.google.com/apis/credentials",
    permissions: ["See your channel", "Read and reply to comments on your videos"],
  },
  tiktok: {
    label: "TikTok",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    // video.upload sends drafts to the TikTok app; direct posting (video.publish) needs TikTok's app audit.
    scopes: ["user.info.basic", "video.upload"],
    scopeSeparator: ",",
    clientIdParam: "client_key",
    pkce: false,
    env: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
    portal: "https://developers.tiktok.com/apps",
    permissions: ["Read your display name", "Send videos to your TikTok drafts"],
  },
};
