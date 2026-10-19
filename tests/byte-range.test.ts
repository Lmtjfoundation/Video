import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/byte-range";

describe("byte ranges for video playback", () => {
  it("answers the ranges Safari and iPhones ask for", () => {
    expect(parseRange(null, 1000)).toBe("none");
    expect(parseRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 }); // Safari's first probe
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=500-2000", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBeNull(); // past the end: 416
    expect(parseRange("bytes=0-1,5-9", 1000)).toBe("none"); // several ranges: whole file
  });
});
