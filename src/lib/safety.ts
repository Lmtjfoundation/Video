import type { Platform } from "./types";
import { PLATFORM_SPECS } from "./platforms/specs";

/**
 * Two layers of protection:
 *  1. classifyComment — decides whether the agent should reply at all.
 *  2. checkOutput     — scans anything the agent wrote before it can be published.
 * Flags prefixed "block:" stop autonomous publishing; "warn:" flags are shown for review.
 */

export type CommentAction = "reply" | "skip" | "escalate";

const SPAM = [
  /\b(dm|message) me\b.*\b(invest|profit|earn|trade|crypto|forex)/i,
  /\bcheck (my|out my) (profile|bio|page)\b/i,
  /\b(giveaway|airdrop|free (btc|eth|crypto|money))\b/i,
  /\b(whatsapp|telegram)\b.*\+?\d{6,}/i,
  /\b(promote|promotion) (your|ur) (page|account)\b/i,
  /(?:https?:\/\/|www\.)\S+.*(?:https?:\/\/|www\.)\S+/i, // multiple links
  /\b(sugar ?daddy|onlyfans|of link|nudes?)\b/i,
];

const HOSTILE = [
  /\b(kys|kill yourself)\b/i,
  /\b(retard(ed)?|f[a@]gg?ot|n[i1]gg(er|a)|tranny|c[u*]nt)\b/i,
  /\b(scam(mer)?|fraud|grifter|clown|idiot|moron|loser)\b/i,
];

const SELF_HARM = [
  /\b(suicid(e|al)|end it all|want to die|kill myself|self[- ]?harm|cutting myself|no reason to live)\b/i,
];

const MINOR = [/\b(i'?m|i am|im)\s*(1[0-7]|[89])\b/i, /\b(1[0-7]|[89])\s*(yo|y\/o|years? old)\b/i, /\b(high school|middle school|my (teen|son|daughter) is (1[0-7]|[89]))\b/i];

const PERSONAL_ADVICE = [/\bshould i (buy|sell|invest|quit|leave|divorce|take)\b/i, /\bwhat (stock|coin|crypto) should\b/i, /\b(dosage|how much .* should i take)\b/i];

export function classifyComment(text: string): { action: CommentAction; flags: string[] } {
  const t = text.trim();
  const flags: string[] = [];
  if (!t) return { action: "skip", flags: ["empty"] };
  if (SELF_HARM.some((r) => r.test(t))) return { action: "escalate", flags: ["self_harm_signal"] };
  if (MINOR.some((r) => r.test(t))) return { action: "escalate", flags: ["possible_minor"] };
  if (SPAM.some((r) => r.test(t))) return { action: "skip", flags: ["spam"] };
  if (HOSTILE.slice(0, 2).some((r) => r.test(t))) return { action: "skip", flags: ["abusive"] };
  if (HOSTILE[2].test(t)) flags.push("hostile_tone");
  if (PERSONAL_ADVICE.some((r) => r.test(t))) flags.push("asks_personal_advice");
  // Emoji-only / very short acknowledgements: a like is better than a reply.
  if (t.replace(/[\p{Emoji}\s!.?]/gu, "").length < 3) return { action: "skip", flags: ["low_signal"] };
  return { action: "reply", flags };
}

const BLOCK_PATTERNS: [RegExp, string][] = [
  [/\b(guaranteed|guarantee[sd]?) (returns?|profits?|income|results?)\b/i, "block:financial_guarantee"],
  [/\brisk[- ]free\b/i, "block:financial_guarantee"],
  [/\b(can'?t|cannot) lose\b/i, "block:financial_guarantee"],
  [/\bget rich quick\b/i, "block:hype"],
  [/\b(cures?|reverses?|treats?) (cancer|diabetes|depression|anxiety|disease)\b/i, "block:medical_claim"],
  [/\b(buy|sell|short) (\$?[A-Z]{2,5}|bitcoin|btc|eth|tesla|nvidia) (now|today|immediately)\b/i, "block:trade_call"],
  [/\b(porn|nude|naked|orgasm|blowjob|cum|dick|pussy|cock|anal sex|threesome)\b/i, "block:explicit"],
  [/\b(kill yourself|kys)\b/i, "block:abusive"],
];

const SLOP: RegExp[] = [
  /in today'?s fast[- ]paced world/i,
  /\blet'?s dive in\b/i,
  /\bgame[- ]?changer\b/i,
  /\bunlock your (full )?potential\b/i,
  /\bdelve\b/i,
  /\bnavigate the (complex )?landscape\b/i,
  /\bbuckle up\b/i,
  /\bhere'?s the kicker\b/i,
];

export function checkOutput(
  text: string,
  platform: Platform,
  opts: { allowedUrls?: string[]; perPartLimit?: number } = {},
): { ok: boolean; flags: string[] } {
  const flags = new Set<string>();
  for (const [re, flag] of BLOCK_PATTERNS) if (re.test(text)) flags.add(flag);
  if (SLOP.some((r) => r.test(text))) flags.add("warn:ai_slop_phrase");

  const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  const allowed = opts.allowedUrls ?? [];
  if (urls.some((u) => !allowed.some((a) => u.startsWith(a)))) flags.add("block:unapproved_link");

  const limit = opts.perPartLimit ?? PLATFORM_SPECS[platform].maxChars;
  if (text.length > limit) flags.add("warn:over_length");

  const emoji = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emoji > 6) flags.add("warn:emoji_heavy");

  const list = [...flags];
  return { ok: !list.some((f) => f.startsWith("block:")), flags: list };
}

export const hasBlockingFlag = (flags: string[]) => flags.some((f) => f.startsWith("block:"));
