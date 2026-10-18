import "server-only";
import { claudeJson } from "./llm";

/** "Explain this": turns any pasted text into a clear, plain-language explanation. */

export const EXPLAIN_LEVELS = {
  simple: "a curious 12-year-old: short sentences, everyday words, no jargon",
  general: "a busy adult with no background in the subject: plain English, jargon explained the first time it appears",
  expert: "a smart professional from a different field: precise, but every specialist term defined",
} as const;
export type ExplainLevel = keyof typeof EXPLAIN_LEVELS;

export const MAX_EXPLAIN_CHARS = 20_000;

export interface Explanation {
  title: string;
  /** One or two sentences: the whole thing in a nutshell. */
  summary: string;
  /** The explanation, as short paragraphs. */
  explanation: string[];
  keyPoints: string[];
  glossary: { term: string; meaning: string }[];
  /** A concrete example or analogy, labeled as one. */
  example: string;
  /** Claims in the text that a reader should double-check, or parts that are unclear or disputed. */
  caveats: string[];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** Keeps only well-formed fields so a sloppy model answer can't break the page. */
export function cleanExplanation(raw: Partial<Record<keyof Explanation, unknown>>): Explanation {
  const glossary = Array.isArray(raw.glossary)
    ? raw.glossary
        .map((g) => ({ term: str((g as { term?: unknown })?.term, 80), meaning: str((g as { meaning?: unknown })?.meaning, 300) }))
        .filter((g) => g.term && g.meaning)
        .slice(0, 12)
    : [];
  const ex: Explanation = {
    title: str(raw.title, 120) || "Explanation",
    summary: str(raw.summary, 600),
    explanation: strs(raw.explanation, 12, 1500),
    keyPoints: strs(raw.keyPoints, 8, 300),
    glossary,
    example: str(raw.example, 1200),
    caveats: strs(raw.caveats, 6, 300),
  };
  if (!ex.summary && !ex.explanation.length) throw new Error("The explanation came back empty. Try again.");
  return ex;
}

export async function explainText(text: string, level: ExplainLevel): Promise<Explanation> {
  const source = text.trim().slice(0, MAX_EXPLAIN_CHARS);
  if (source.length < 20) throw new Error("Paste a bit more text to explain (at least a sentence).");
  const raw = await claudeJson<Partial<Record<keyof Explanation, unknown>>>({
    system:
      "You explain things clearly and accurately. You only explain what the text says (plus widely documented background); you never invent facts, numbers or quotes. When the text is unclear, one-sided or makes claims that need checking, you say so plainly.",
    user: `Explain the text below for ${EXPLAIN_LEVELS[level]}.
TEXT:
"""
${source}
"""
Reply with ONLY JSON:
{"title":"what this is about, under 80 characters","summary":"the whole thing in 1–2 sentences","explanation":["3–6 short paragraphs, in a logical order"],"keyPoints":["3–6 takeaways"],"glossary":[{"term":"…","meaning":"…"}],"example":"one concrete example or analogy, starting with 'For example' or 'Think of it like'","caveats":["claims to double-check, missing context or disputed points (empty if none)"]}`,
    maxTokens: 2500,
    temperature: 0.4,
  });
  return cleanExplanation(raw);
}

/** Plain-text version for copying, saving as a post, or feeding the explainer-video writer. */
export function explanationText(e: Explanation): string {
  return [
    e.title,
    "",
    e.summary,
    "",
    ...e.explanation.flatMap((p) => [p, ""]),
    e.keyPoints.length ? "Key points:" : "",
    ...e.keyPoints.map((k) => `• ${k}`),
    e.example ? `\n${e.example}` : "",
    e.glossary.length ? "\nTerms:" : "",
    ...e.glossary.map((g) => `• ${g.term}: ${g.meaning}`),
    e.caveats.length ? "\nWorth checking:" : "",
    ...e.caveats.map((c) => `• ${c}`),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
