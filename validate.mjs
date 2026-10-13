// Checks inbox.json against BRIEF.md before a batch is pushed. Run: node validate.mjs
import { readFileSync } from "node:fs";

const PLATFORMS = ["x", "facebook", "linkedin", "instagram", "youtube", "tiktok"];
const PILLARS = ["ai_leverage", "high_agency", "wealth_systems", "relationships", "longevity"];
const FORMATS = ["short", "thread", "carousel", "caption"];
const STYLES = ["true", "funny", "explainer", "countdown", "fiction"];
const LENGTHS = { s30: [65, 90, 8, 11], s60: [120, 150, 12, 16], s90: [170, 230, 16, 22], m3: [430, 480, 36, 48], long: [1200, 1500, 40, 60] };
const BANNED = [
  /in today'?s fast[- ]paced world/i, /\blet'?s dive in\b/i, /\bgame[- ]?changer\b/i, /\bunlock your (full )?potential\b/i,
  /\bdelve\b/i, /\bnavigate the (complex )?landscape\b/i, /\bbuckle up\b/i, /\bhere'?s the kicker\b/i, /\belevate\b/i,
  /\bit'?s important to note\b/i, /\bguarantee[sd]?\b/i, /\brisk[- ]free\b/i, /\b(can'?t|cannot) lose\b/i,
  /\bget rich quick\b/i, /\bpassive income while you sleep\b/i,
];

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const tags = (list, max) => list.slice(0, max).map((t) => `#${t}`).join(" ");

let inbox;
try {
  inbox = JSON.parse(readFileSync(new URL("./inbox.json", import.meta.url), "utf8"));
} catch (e) {
  console.error(`inbox.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(inbox.batches)) err("inbox", '"batches" must be an array');
const batches = inbox.batches ?? [];
if (batches.length > 7) err("inbox", `keep at most 7 batches (found ${batches.length})`);
const seen = new Set();

batches.forEach((b, bi) => {
  const where = `batch ${b.id ?? bi}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.id ?? "")) err(where, "id must be YYYY-MM-DD");
  if (bi > 0 && b.id >= batches[bi - 1].id) err(where, "batches must be newest first");
  if (!Array.isArray(b.items)) return err(where, '"items" must be an array');
  if (bi === 0 && b.items.length !== 10) err(where, `the newest batch needs 10 items (found ${b.items.length})`);

  b.items.forEach((it, ii) => {
    const w = `${it.id ?? `${where} item ${ii + 1}`}`;
    if (!new RegExp(`^${b.id}-\\d{2}$`).test(it.id ?? "")) err(w, `id must be ${b.id}-NN`);
    if (seen.has(it.id)) err(w, "duplicate id");
    seen.add(it.id);
    if (!PLATFORMS.includes(it.platform)) err(w, `platform must be one of ${PLATFORMS.join(", ")}`);
    if (!it.topic) err(w, "topic is required");
    if (!Array.isArray(it.hashtags) || it.hashtags.some((h) => typeof h !== "string" || h.startsWith("#") || /\s/.test(h))) err(w, "hashtags must be words without # or spaces");
    const all = JSON.stringify(it);
    for (const re of BANNED) if (re.test(all)) err(w, `banned phrase: ${re}`);

    if (it.type === "post") {
      if (!PILLARS.includes(it.pillar)) err(w, `pillar must be one of ${PILLARS.join(", ")}`);
      if (!FORMATS.includes(it.format)) err(w, `format must be one of ${FORMATS.join(", ")}`);
      if (!it.hook?.trim()) err(w, "hook is required");
      if (!Array.isArray(it.parts)) err(w, "parts must be an array");
      if (it.platform === "x" && it.format === "short") {
        const text = [it.hook, it.body, it.cta].filter(Boolean).join("\n\n");
        const full = [text, tags(it.hashtags ?? [], 2)].filter(Boolean).join("\n\n");
        if (full.length > 280) err(w, `X post is ${full.length} characters with hashtags; the limit is 280`);
      }
      if (it.platform === "x" && it.format === "thread") {
        if (it.parts.length < 4 || it.parts.length > 8) err(w, "X threads need 4–8 parts");
        it.parts.forEach((p, i) => p.length >= 270 && err(w, `thread part ${i + 1} is ${p.length} characters (keep under 270)`));
      }
      if (it.platform === "linkedin" && it.format === "short") {
        const n = [it.hook, it.body].join("\n\n").length;
        if (n < 600 || n > 3000) err(w, `LinkedIn post is ${n} characters; aim for 700–1,300`);
      }
      if (it.format === "carousel" && (it.parts.length < 6 || it.parts.length > 10)) err(w, "carousels need 6–10 slides");
      if (it.platform === "facebook" && it.format === "short") {
        const n = words([it.hook, it.body].join(" "));
        if (n < 70 || n > 270) err(w, `Facebook post is ${n} words; aim for 80–250`);
      }
    } else if (it.type === "video") {
      if (!STYLES.includes(it.style)) err(w, `style must be one of ${STYLES.join(", ")}`);
      const spec = LENGTHS[it.length];
      if (!spec) return err(w, `length must be one of ${Object.keys(LENGTHS).join(", ")}`);
      if (!Array.isArray(it.titles) || !it.titles.length) err(w, "titles are required");
      (it.titles ?? []).forEach((t) => t.length > 70 && err(w, `title over 70 characters: ${t}`));
      if (!it.hook?.trim()) err(w, "hook is required");
      if (!it.caption?.trim()) err(w, "caption is required");
      if (!Array.isArray(it.factCheck) || !it.factCheck.length) err(w, "factCheck is required");
      const scenes = it.scenes ?? [];
      if (scenes.length < spec[2] || scenes.length > spec[3]) err(w, `${it.length} needs ${spec[2]}–${spec[3]} scenes (found ${scenes.length})`);
      const n = words(scenes.map((s) => s.narration ?? "").join(" "));
      if (n < spec[0] || n > spec[1]) err(w, `${it.length} narration needs ${spec[0]}–${spec[1]} words (found ${n})`);
      scenes.forEach((s, i) => {
        for (const k of ["time", "narration", "onScreen", "visual", "motion"]) if (!s[k]?.trim()) err(w, `scene ${i + 1} is missing ${k}`);
        if (s.onScreen && words(s.onScreen) > 6) err(w, `scene ${i + 1} on-screen text is over 6 words`);
      });
    } else err(w, 'type must be "post" or "video"');
  });
});

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  console.error(`\n${errors.length} problem${errors.length === 1 ? "" : "s"} — fix and run again.`);
  process.exit(1);
}
console.log(`OK — ${batches.length} batch${batches.length === 1 ? "" : "es"}, ${seen.size} items.`);
