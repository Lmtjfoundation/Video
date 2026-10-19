/** "bytes=START-END" (either end may be missing) → the byte range to send, or null when it can't be satisfied. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "none" {
  if (!header) return "none";
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "none"; // several ranges or a bad header: send the whole file
  let start: number, end: number;
  if (!m[1]) {
    // "bytes=-500": the last 500 bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? null : { start, end };
}
