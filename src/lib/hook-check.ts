/** What's wrong with a video's opening line (empty when it's a good hook): too long to land in 2–3 seconds, or filler. */
export function hookProblems(line: string): string[] {
  const t = line.trim();
  const words = t.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  if (!words.length) return ["there is no spoken opening line"];
  if (words.length > 14) out.push(`it is ${words.length} words; a hook lands in 6–12`);
  if (/^(hi|hey|hello|welcome|what'?s up|today|in this video|so,? |let'?s talk|did you know|have you ever wondered)\b/i.test(t)) out.push("it opens with filler instead of the most gripping detail");
  if (/\b(subscribe|like and|smash that)\b/i.test(t)) out.push("it asks for a follow before giving anything");
  return out;
}
