import "server-only";
import type { Credential, Platform, Post } from "../types";
import { AuthError, CopyReadyError, request } from "./http";
import { sleep } from "../utils";
import { postWebhook } from "./webhook-send";

export interface PublishResult {
  externalId: string;
  externalIds: string[];
  url?: string;
}

/** A finished video to upload: bytes for direct uploads, a public signed URL for platforms that fetch it. */
export interface VideoFile {
  bytes: Buffer;
  url: string;
  mime: string;
  size: number;
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
  publish(post: Post, texts: string[], cred: Credential, video?: VideoFile): Promise<PublishResult>;
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

/** X API v2 chunked media upload (initialize → append → finalize → status). Needs the media.write scope. */
async function xUploadVideo(cred: Credential, v: VideoFile): Promise<string> {
  const init = await request<{ data: { id: string } }>(`${X_API}/media/upload/initialize`, {
    method: "POST",
    headers: { ...bearer(cred), "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: v.mime, total_bytes: v.size, media_category: "tweet_video" }),
    label: "X video upload (initialize)",
  });
  const id = init.data.data.id;
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, off = 0; off < v.size; i++, off += CHUNK) {
    const fd = new FormData();
    fd.append("segment_index", String(i));
    fd.append("media", new Blob([new Uint8Array(v.bytes.subarray(off, Math.min(off + CHUNK, v.size)))], { type: "application/octet-stream" }), "chunk");
    await request(`${X_API}/media/upload/${id}/append`, { method: "POST", headers: bearer(cred), body: fd, label: "X video upload (append)" });
  }
  type Info = { state: string; check_after_secs?: number; error?: { message?: string } };
  const fin = await request<{ data?: { processing_info?: Info } }>(`${X_API}/media/upload/${id}/finalize`, {
    method: "POST",
    headers: bearer(cred),
    label: "X video upload (finalize)",
  });
  let info = fin.data.data?.processing_info;
  for (let k = 0; info && info.state !== "succeeded" && k < 60; k++) {
    if (info.state === "failed") throw new Error(`X couldn't process the video: ${info.error?.message ?? "unknown error"}`);
    await sleep(Math.min(15, info.check_after_secs ?? 3) * 1000);
    const st = await request<{ data?: { processing_info?: Info } }>(`${X_API}/media/upload?command=STATUS&media_id=${id}`, {
      headers: bearer(cred),
      label: "X video upload (status)",
    });
    info = st.data.data?.processing_info;
  }
  return id;
}

const x: Adapter = {
  platform: "x",
  publishable: () => true,
  async publish(_post, texts, cred, video) {
    const ids: string[] = [];
    const mediaId = video ? await xUploadVideo(cred, video) : null;
    for (const text of texts) {
      const body: Record<string, unknown> = { text };
      if (mediaId && !ids.length) body.media = { media_ids: [mediaId] };
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
  async publish(_post, texts, cred, video) {
    const pageId = need(cred, "accountId", "Facebook Page ID is missing — connect Facebook again.");
    if (video) {
      // Graph API video upload by URL: Facebook fetches the file from the signed link.
      const { data } = await request<{ id: string }>(`${fbGraph().replace("graph.facebook.com", "graph-video.facebook.com")}/${pageId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ file_url: video.url, description: texts.join("\n\n"), access_token: cred.accessToken! }),
        label: "Facebook Page video",
      });
      return { externalId: data.id, externalIds: [data.id], url: `https://www.facebook.com/${pageId}/videos/${data.id}` };
    }
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

/** LinkedIn Videos API: initializeUpload → PUT each part → finalizeUpload → wait until AVAILABLE. */
async function linkedinUploadVideo(cred: Credential, owner: string, v: VideoFile): Promise<string> {
  const headers = { ...bearer(cred), "Content-Type": "application/json", "LinkedIn-Version": linkedinVersion(), "X-Restli-Protocol-Version": "2.0.0" };
  const init = await request<{ value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>(
    "https://api.linkedin.com/rest/videos?action=initializeUpload",
    { method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: v.size, uploadCaptions: false, uploadThumbnail: false } }), label: "LinkedIn video (initialize)" },
  );
  const { video, uploadToken, uploadInstructions } = init.data.value;
  const etags: string[] = [];
  for (const part of uploadInstructions) {
    const res = await request(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(v.bytes.subarray(part.firstByte, part.lastByte + 1)),
      label: "LinkedIn video (upload part)",
    });
    etags.push((res.headers.get("etag") ?? "").replace(/"/g, ""));
  }
  await request("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers,
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken: uploadToken ?? "", uploadedPartIds: etags } }),
    label: "LinkedIn video (finalize)",
  });
  for (let i = 0; i < 40; i++) {
    const st = await request<{ status?: string }>(`https://api.linkedin.com/rest/videos/${encodeURIComponent(video)}`, { headers, label: "LinkedIn video (status)" });
    if (st.data.status === "AVAILABLE") return video;
    if (st.data.status === "PROCESSING_FAILED") throw new Error("LinkedIn couldn't process the video.");
    await sleep(6000);
  }
  throw new Error("LinkedIn is still processing the video — it will retry shortly.");
}

const linkedin: Adapter = {
  platform: "linkedin",
  publishable: () => true,
  async publish(post, texts, cred, video) {
    const author = need(cred, "accountId", "LinkedIn author URN (urn:li:person:… or urn:li:organization:…) is missing.");
    const media = video ? { id: await linkedinUploadVideo(cred, author, video), title: (post.video?.titles[0] ?? post.hook).slice(0, 200) } : null;
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
        ...(media ? { content: { media } } : {}),
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
    post.kind === "video" || (post.imageUrl && /^https:\/\//.test(post.imageUrl))
      ? true
      : "Instagram requires a public https image URL — add one to the post, or post it manually.",
  async publish(post, texts, cred, video) {
    const ig = need(cred, "accountId", "Instagram Business/Creator user ID is missing.");
    const token = cred.accessToken!;
    if (video) {
      // Reels: create a container from the public video URL, wait for processing, then publish.
      const box = await request<{ id: string }>(
        `${graph()}/${ig}/media?` + new URLSearchParams({ media_type: "REELS", video_url: video.url, caption: texts.join("\n\n"), share_to_feed: "true", access_token: token }),
        { method: "POST", label: "Instagram Reel container" },
      );
      let ready = false;
      for (let i = 0; i < 30 && !ready; i++) {
        await sleep(10_000);
        const { data } = await request<{ status_code?: string }>(`${graph()}/${box.data.id}?fields=status_code&access_token=${encodeURIComponent(token)}`, { label: "Instagram Reel status" });
        if (data.status_code === "FINISHED") ready = true;
        else if (data.status_code === "ERROR" || data.status_code === "EXPIRED") throw new Error("Instagram couldn't process the video (check length 3 s–15 min, MP4/H.264).");
      }
      if (!ready) throw new Error("Instagram is still processing the Reel — it will retry shortly.");
      const pub = await request<{ id: string }>(`${graph()}/${ig}/media_publish?` + new URLSearchParams({ creation_id: box.data.id, access_token: token }), { method: "POST", label: "Instagram publish Reel" });
      let url: string | undefined;
      try {
        url = (await request<{ permalink?: string }>(`${graph()}/${pub.data.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, { label: "Instagram permalink" })).data.permalink;
      } catch {
        /* optional */
      }
      return { externalId: pub.data.id, externalIds: [pub.data.id], url };
    }
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
  publishable: (post) => (post.kind === "video" ? true : "YouTube needs a video — create a Video post and render it."),
  async publish(post, texts, cred, video) {
    if (!video) throw new CopyReadyError("YouTube needs a rendered video file.");
    const vertical = post.video?.length !== "long";
    const title = (post.video?.titles[0] ?? post.hook).replace(/[<>]/g, "").slice(0, 100);
    const description = [texts.join("\n\n"), vertical ? "#Shorts" : ""].filter(Boolean).join("\n\n").replace(/[<>]/g, "").slice(0, 4900);
    // Resumable upload: create the session with metadata, then send the bytes to the returned Location.
    const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        ...bearer(cred),
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(video.size),
        "X-Upload-Content-Type": video.mime,
      },
      body: JSON.stringify({
        snippet: { title, description, tags: post.hashtags.slice(0, 15), categoryId: process.env.YOUTUBE_CATEGORY_ID || "27" },
        status: { privacyStatus: process.env.YOUTUBE_PRIVACY || "public", selfDeclaredMadeForKids: false },
      }),
    });
    const location = start.headers.get("location");
    if (!start.ok || !location) {
      const t = (await start.text()).slice(0, 300);
      if (start.status === 401 || start.status === 403) throw new AuthError(`YouTube upload: ${start.status} ${t}`);
      throw new Error(`YouTube upload start failed: ${start.status} ${t}`);
    }
    const { data } = await request<{ id: string }>(location, {
      method: "PUT",
      headers: { "Content-Type": video.mime, "Content-Length": String(video.size) },
      body: new Uint8Array(video.bytes),
      label: "YouTube upload",
    });
    const url = vertical ? `https://www.youtube.com/shorts/${data.id}` : `https://www.youtube.com/watch?v=${data.id}`;
    return { externalId: data.id, externalIds: [data.id], url };
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
  publishable: (post) => (post.kind === "video" ? true : "TikTok needs a video — create a Video post and render it."),
  async publish(_post, _texts, cred, video) {
    if (!video) throw new CopyReadyError("TikTok needs a rendered video file.");
    // Upload to the creator's TikTok inbox (drafts). Direct public posting needs TikTok's app audit.
    const MB = 1024 * 1024;
    const chunk = video.size <= 64 * MB ? video.size : 10 * MB;
    const total = video.size <= 64 * MB ? 1 : Math.floor(video.size / chunk);
    const init = await request<{ data: { publish_id: string; upload_url: string }; error?: { code: string; message: string } }>(
      "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
      {
        method: "POST",
        headers: { ...bearer(cred), "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: video.size, chunk_size: chunk, total_chunk_count: total } }),
        label: "TikTok upload (init)",
      },
    );
    if (init.data.error && init.data.error.code !== "ok") throw new Error(`TikTok: ${init.data.error.message}`);
    for (let i = 0; i < total; i++) {
      const first = i * chunk;
      const last = i === total - 1 ? video.size - 1 : first + chunk - 1; // the last chunk takes the remainder
      await request(init.data.data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": video.mime, "Content-Length": String(last - first + 1), "Content-Range": `bytes ${first}-${last}/${video.size}` },
        body: new Uint8Array(video.bytes.subarray(first, last + 1)),
        label: "TikTok upload (chunk)",
      });
    }
    return { externalId: init.data.data.publish_id, externalIds: [init.data.data.publish_id], url: undefined };
  },
  engageable: false,
  async fetchComments() {
    throw new CopyReadyError("TikTok has no general comment API.");
  },
  async reply() {
    throw new CopyReadyError("TikTok has no general comment API.");
  },
};

/* ───────────────────────────── Any app (webhook) ───────────────────────────── */
/** Sends each post as JSON to a URL the customer owns (Zapier, Make, n8n, Slack, Discord, their own server). */
const webhook: Adapter = {
  platform: "webhook",
  publishable: (post) => (post.kind === "video" ? "Video files can't be sent through a webhook. Download the video and post it in your app." : true),
  async publish(post, texts, cred) {
    const url = need(cred, "accessToken", "Add your webhook URL in Settings → Accounts.");
    const res = await postWebhook(
      url,
      {
        event: "post.publish",
        id: post.id,
        platform: post.platform,
        format: post.format,
        pillar: post.pillar,
        topic: post.topic ?? null,
        hook: post.hook,
        body: post.body,
        parts: post.parts,
        hashtags: post.hashtags,
        cta: post.cta ?? null,
        imageUrl: post.imageUrl ?? null,
        text: texts.join("\n\n"),
        texts,
        scheduledAt: post.scheduledAt ?? null,
        sentAt: new Date().toISOString(),
      },
      cred.refreshToken, // optional signing secret
    );
    // "Published" here means the receiving tool accepted it; what it does next is up to that tool.
    return { externalId: `webhook:${res.status}:${post.id}`, externalIds: [`webhook:${res.status}:${post.id}`], url: undefined };
  },
  engageable: false,
  async fetchComments() {
    throw new CopyReadyError("A webhook only sends posts out; it can't read comments.");
  },
  async reply() {
    throw new CopyReadyError("A webhook only sends posts out; it can't send replies.");
  },
};

export const ADAPTERS: Record<Platform, Adapter> = { x, facebook, linkedin, instagram, youtube, tiktok, webhook };
