import "server-only";
import type { Credential, Platform, Post } from "../types";
import { CopyReadyError, request } from "./http";
import { sleep } from "../utils";

export interface PublishResult {
  externalId: string;
  externalIds: string[];
  url?: string;
}

export interface RawComment {
  externalId: string;
  postExternalId: string;
  author: string;
  authorFollowers?: number;
  text: string;
  createdAt: string;
}

export interface Adapter {
  platform: Platform;
  /** Whether autopilot can publish this post here (string = reason it can't). */
  publishable(post: Post): true | string;
  publish(post: Post, texts: string[], cred: Credential): Promise<PublishResult>;
  engageable: boolean;
  fetchComments(cred: Credential, postExternalIds: string[]): Promise<RawComment[]>;
  reply(cred: Credential, target: { commentExternalId: string; postExternalId: string }, text: string): Promise<string>;
}

const bearer = (c: Credential) => ({ Authorization: `Bearer ${c.accessToken}` });
const need = (c: Credential, field: keyof Credential, msg: string) => {
  if (!c[field]) throw new CopyReadyError(msg);
  return c[field] as string;
};

/* ───────────────────────────── X (Twitter) API v2 ───────────────────────────── */
const X_API = "https://api.x.com/2";

const x: Adapter = {
  platform: "x",
  publishable: () => true,
  async publish(_post, texts, cred) {
    const ids: string[] = [];
    for (const text of texts) {
      const body: Record<string, unknown> = { text };
      if (ids.length) body.reply = { in_reply_to_tweet_id: ids[ids.length - 1] };
      const { data } = await request<{ data: { id: string } }>(`${X_API}/tweets`, {
        method: "POST",
        headers: { ...bearer(cred), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        label: "X create post",
      });
      ids.push(data.data.id);
      if (texts.length > 1) await sleep(1500);
    }
    const handle = cred.handle?.replace(/^@/, "");
    return { externalId: ids[0], externalIds: ids, url: `https://x.com/${handle || "i/web"}/status/${ids[0]}` };
  },
  engageable: true,
  async fetchComments(cred, postIds) {
    const out: RawComment[] = [];
    for (const id of postIds) {
      const q = encodeURIComponent(`conversation_id:${id} is:reply -is:retweet`);
      const url = `${X_API}/tweets/search/recent?query=${q}&max_results=50&tweet.fields=author_id,created_at,conversation_id&expansions=author_id&user.fields=username,public_metrics`;
      const { data } = await request<{
        data?: { id: string; text: string; author_id: string; created_at: string }[];
        includes?: { users?: { id: string; username: string; public_metrics?: { followers_count: number } }[] };
      }>(url, { headers: bearer(cred), label: "X search replies" });
      const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
      for (const t of data.data ?? []) {
        if (cred.accountId && t.author_id === cred.accountId) continue; // skip our own replies
        const u = users.get(t.author_id);
        out.push({
          externalId: t.id,
          postExternalId: id,
          author: u ? `@${u.username}` : t.author_id,
          authorFollowers: u?.public_metrics?.followers_count,
          text: t.text,
          createdAt: t.created_at,
        });
      }
    }
    return out;
  },
  async reply(cred, target, text) {
    const { data } = await request<{ data: { id: string } }>(`${X_API}/tweets`, {
      method: "POST",
      headers: { ...bearer(cred), "Content-Type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: target.commentExternalId } }),
      label: "X reply",
    });
    return data.data.id;
  },
};

/* ───────────────────────────── Facebook Pages (Graph API) ───────────────────────────── */
const fbGraph = () => `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || "v25.0"}`;

const facebook: Adapter = {
  platform: "facebook",
  publishable: () => true,
  async publish(_post, texts, cred) {
    const pageId = need(cred, "accountId", "Facebook Page ID is missing — connect Facebook again.");
    const { data } = await request<{ id: string }>(`${fbGraph()}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: texts.join("\n\n"), access_token: cred.accessToken! }),
      label: "Facebook Page post",
    });
    // Post ids look like {pageId}_{postId}; facebook.com/{id} opens the post.
    return { externalId: data.id, externalIds: [data.id], url: `https://www.facebook.com/${data.id}` };
  },
  engageable: true,
  async fetchComments(cred, postIds) {
    const out: RawComment[] = [];
    for (const id of postIds) {
      const { data } = await request<{ data?: { id: string; message?: string; created_time: string; from?: { id: string; name: string } }[] }>(
        `${fbGraph()}/${id}/comments?` + new URLSearchParams({ fields: "id,message,created_time,from", filter: "toplevel", limit: "50", access_token: cred.accessToken! }),
        { label: "Facebook comments" },
      );
      for (const c of data.data ?? []) {
        if (!c.message || (cred.accountId && c.from?.id === cred.accountId)) continue; // skip empty and our own
        out.push({ externalId: c.id, postExternalId: id, author: c.from?.name || "Facebook user", text: c.message, createdAt: c.created_time });
      }
    }
    return out;
  },
  async reply(cred, target, text) {
    const { data } = await request<{ id: string }>(`${fbGraph()}/${target.commentExternalId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: text, access_token: cred.accessToken! }),
      label: "Facebook reply",
    });
    return data.id;
  },
};

/* ───────────────────────────── LinkedIn Posts API ───────────────────────────── */
function linkedinVersion() {
  if (process.env.LINKEDIN_API_VERSION) return process.env.LINKEDIN_API_VERSION;
  // LinkedIn ships monthly versions and supports each for about a year; use two months back.
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 2);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** LinkedIn "little text" format reserves these characters. */
const liEscape = (s: string) => s.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => `\\${c}`);

const linkedin: Adapter = {
  platform: "linkedin",
  publishable: () => true,
  async publish(_post, texts, cred) {
    const author = need(cred, "accountId", "LinkedIn author URN (urn:li:person:… or urn:li:organization:…) is missing.");
    const { headers } = await request(`https://api.linkedin.com/rest/posts`, {
      method: "POST",
      headers: {
        ...bearer(cred),
        "Content-Type": "application/json",
        "LinkedIn-Version": linkedinVersion(),
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author,
        commentary: liEscape(texts.join("\n\n")),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      label: "LinkedIn create post",
    });
    const id = headers.get("x-restli-id") ?? headers.get("x-linkedin-id") ?? "";
    return { externalId: id, externalIds: [id], url: id ? `https://www.linkedin.com/feed/update/${id}/` : undefined };
  },
  engageable: false,
  async fetchComments() {
    throw new CopyReadyError("LinkedIn comment access requires Community Management API approval.");
  },
  async reply() {
    throw new CopyReadyError("LinkedIn replies require Community Management API approval.");
  },
};

/* ───────────────────────────── Instagram Graph API ───────────────────────────── */
const graph = () =>
  `https://${process.env.META_GRAPH_HOST || "graph.instagram.com"}/${process.env.META_GRAPH_VERSION || "v23.0"}`;

const instagram: Adapter = {
  platform: "instagram",
  publishable: (post) =>
    post.imageUrl && /^https:\/\//.test(post.imageUrl)
      ? true
      : "Instagram requires a public https image URL — add one to the post, or post it manually.",
  async publish(post, texts, cred) {
    const ig = need(cred, "accountId", "Instagram Business/Creator user ID is missing.");
    const token = cred.accessToken!;
    const create = await request<{ id: string }>(
      `${graph()}/${ig}/media?` +
        new URLSearchParams({ image_url: post.imageUrl!, caption: texts.join("\n\n"), access_token: token }),
      { method: "POST", label: "Instagram create container" },
    );
    // Containers can take a few seconds to finish processing.
    for (let i = 0; i < 6; i++) {
      const { data } = await request<{ status_code?: string }>(
        `${graph()}/${create.data.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
        { label: "Instagram container status" },
      );
      if (!data.status_code || data.status_code === "FINISHED") break;
      if (data.status_code === "ERROR") throw new Error("Instagram rejected the media (check image URL / format).");
      await sleep(3000);
    }
    const pub = await request<{ id: string }>(
      `${graph()}/${ig}/media_publish?` + new URLSearchParams({ creation_id: create.data.id, access_token: token }),
      { method: "POST", label: "Instagram publish" },
    );
    let url: string | undefined;
    try {
      const { data } = await request<{ permalink?: string }>(
        `${graph()}/${pub.data.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
        { label: "Instagram permalink" },
      );
      url = data.permalink;
    } catch {
      /* permalink is optional */
    }
    return { externalId: pub.data.id, externalIds: [pub.data.id], url };
  },
  engageable: true,
  async fetchComments(cred, postIds) {
    const out: RawComment[] = [];
    for (const id of postIds) {
      const { data } = await request<{ data?: { id: string; text: string; username?: string; timestamp: string }[] }>(
        `${graph()}/${id}/comments?fields=id,text,username,timestamp&limit=50&access_token=${encodeURIComponent(cred.accessToken!)}`,
        { label: "Instagram comments" },
      );
      for (const c of data.data ?? []) {
        if (cred.handle && c.username === cred.handle.replace(/^@/, "")) continue;
        out.push({ externalId: c.id, postExternalId: id, author: c.username ? `@${c.username}` : "user", text: c.text, createdAt: c.timestamp });
      }
    }
    return out;
  },
  async reply(cred, target, text) {
    const { data } = await request<{ id: string }>(
      `${graph()}/${target.commentExternalId}/replies?` + new URLSearchParams({ message: text, access_token: cred.accessToken! }),
      { method: "POST", label: "Instagram reply" },
    );
    return data.id;
  },
};

/* ───────────────────────────── YouTube Data API v3 ───────────────────────────── */
const YT = "https://www.googleapis.com/youtube/v3";

const youtube: Adapter = {
  platform: "youtube",
  publishable: () => "YouTube video upload isn't automated — the script is ready to record and post.",
  async publish() {
    throw new CopyReadyError("YouTube publishing is copy-ready in this version.");
  },
  engageable: true,
  async fetchComments(cred) {
    const channel = need(cred, "accountId", "YouTube channel ID is missing.");
    const { data } = await request<{
      items?: {
        id: string;
        snippet: { videoId: string; topLevelComment: { id: string; snippet: { textOriginal: string; authorDisplayName: string; authorChannelId?: { value: string }; publishedAt: string } } };
      }[];
    }>(`${YT}/commentThreads?part=snippet&allThreadsRelatedToChannelId=${channel}&maxResults=50&order=time`, {
      headers: bearer(cred),
      label: "YouTube comment threads",
    });
    return (data.items ?? [])
      .filter((t) => t.snippet.topLevelComment.snippet.authorChannelId?.value !== channel)
      .map((t) => ({
        externalId: t.snippet.topLevelComment.id,
        postExternalId: t.snippet.videoId,
        author: t.snippet.topLevelComment.snippet.authorDisplayName,
        text: t.snippet.topLevelComment.snippet.textOriginal,
        createdAt: t.snippet.topLevelComment.snippet.publishedAt,
      }));
  },
  async reply(cred, target, text) {
    const { data } = await request<{ id: string }>(`${YT}/comments?part=snippet`, {
      method: "POST",
      headers: { ...bearer(cred), "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: target.commentExternalId, textOriginal: text } }),
      label: "YouTube reply",
    });
    return data.id;
  },
};

/* ───────────────────────────── TikTok ───────────────────────────── */
const tiktok: Adapter = {
  platform: "tiktok",
  publishable: () => "TikTok direct posting needs an audited Content Posting API app — script is copy-ready.",
  async publish() {
    throw new CopyReadyError("TikTok publishing is copy-ready.");
  },
  engageable: false,
  async fetchComments() {
    throw new CopyReadyError("TikTok has no general comment API.");
  },
  async reply() {
    throw new CopyReadyError("TikTok has no general comment API.");
  },
};

export const ADAPTERS: Record<Platform, Adapter> = { x, facebook, linkedin, instagram, youtube, tiktok };
