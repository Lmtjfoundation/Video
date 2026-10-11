import { videoPlanText } from "./video-spec";
import type { Offer, Post, Settings } from "./types";
import { PLATFORM_SPECS } from "./platforms/specs";

const tagify = (tags: string[], max: number) =>
  tags
    .map((t) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .slice(0, max)
    .map((t) => `#${t}`)
    .join(" ");

export function offerFor(post: Pick<Post, "offerId">, settings: Settings): Offer | undefined {
  return post.offerId ? settings.offers.find((o) => o.id === post.offerId) : undefined;
}

/** Text appended when a post promotes an offer: link + required disclosure. */
export function offerTail(post: Post, settings: Settings) {
  const offer = offerFor(post, settings);
  if (!offer) return "";
  return `${offer.url}\n${settings.disclosure}`.trim();
}

/** Split long text into tweet-sized parts on sentence boundaries. */
export function splitIntoParts(text: string, limit: number): string[] {
  const sentences = text.replace(/\s+\n/g, "\n").split(/(?<=[.!?])\s+|\n{2,}/);
  const parts: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if ((cur ? cur + " " : "").length + piece.length <= limit) {
      cur = cur ? `${cur} ${piece}` : piece;
    } else {
      if (cur) parts.push(cur);
      if (piece.length <= limit) cur = piece;
      else {
        // Hard-wrap an oversized sentence on word boundaries.
        let chunk = "";
        for (const w of piece.split(" ")) {
          if ((chunk + " " + w).trim().length > limit) {
            parts.push(chunk.trim());
            chunk = w;
          } else chunk = `${chunk} ${w}`;
        }
        cur = chunk.trim();
      }
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * Returns the final publishable text units for a post.
 * Single-post platforms → one item. X threads → one item per tweet.
 */
export function renderPost(post: Post, settings: Settings): string[] {
  const spec = PLATFORM_SPECS[post.platform];
  const tags = tagify(post.hashtags, spec.maxHashtags);
  const tail = offerTail(post, settings);

  if (post.kind === "video") {
    const caption = [post.body, post.cta, tail, tags].filter(Boolean).join("\n\n");
    return [caption.slice(0, post.platform === "x" ? 280 : spec.maxChars)];
  }

  if (post.platform === "x") {
    const limit = spec.threadPartChars ?? 270;
    if (post.format === "thread" && post.parts.length) {
      const parts = post.parts.map((p) => p.trim()).filter(Boolean);
      const last = [post.cta, tail, tags].filter(Boolean).join("\n");
      if (last) parts.push(last);
      return parts.flatMap((p) => (p.length > 280 ? splitIntoParts(p, limit) : [p]));
    }
    const single = [post.hook, post.body, post.cta].filter(Boolean).join("\n\n");
    const withTags = [single, tags].filter(Boolean).join("\n\n");
    if (withTags.length <= 280 && !tail) return [withTags];
    // Too long for one tweet → auto-thread, link + disclosure in the final reply.
    const parts = splitIntoParts(single, limit);
    const end = [tail, tags].filter(Boolean).join("\n");
    if (end) parts.push(end);
    return parts;
  }

  const sections: string[] = [post.hook];
  if (post.body) sections.push(post.body);
  if (post.parts.length && post.format !== "video_script") {
    sections.push(post.parts.map((p, i) => `${i + 1}/ ${p}`).join("\n\n"));
  }
  if (post.cta) sections.push(post.cta);
  if (tail) sections.push(tail);
  if (tags) sections.push(tags);
  return [sections.join("\n\n").slice(0, spec.maxChars)];
}

/** Human-readable full copy, including scripts/slides, for copy-ready mode and exports. */
export function copyText(post: Post, settings: Settings): string {
  if (post.kind === "video" && post.video) return videoPlanText(post.video, PLATFORM_SPECS[post.platform].name, renderPost(post, settings).join("\n"));
  if (post.format === "video_script" && post.parts.length) {
    const tags = tagify(post.hashtags, PLATFORM_SPECS[post.platform].maxHashtags);
    return [
      `HOOK: ${post.hook}`,
      "SCRIPT:",
      ...post.parts.map((p, i) => `${i + 1}. ${p}`),
      "",
      "CAPTION / DESCRIPTION:",
      [post.body, post.cta, offerTail(post, settings), tags].filter(Boolean).join("\n\n"),
    ].join("\n");
  }
  return renderPost(post, settings).join("\n\n— — —\n\n");
}
