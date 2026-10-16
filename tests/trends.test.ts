import { describe, expect, it } from "vitest";
import { decode, parseFeed, parseOnThisDay, rankStories } from "@/lib/trends";
import { FEEDS, GENRES, genreById } from "@/lib/genres";
import { lengthAllowed, VIDEO_LENGTHS } from "@/lib/video-spec";
import { planById } from "@/lib/plans";
import { ALGORITHM_PLAYBOOK, NEWS_LOCK, storyBlock } from "@/lib/viral";
import { PLATFORMS } from "@/lib/types";

const now = Date.now();
const rfc = (msAgo: number) => new Date(now - msAgo).toUTCString();

const RSS = `<?xml version="1.0"?><rss><channel><title>NPR</title>
<item><title><![CDATA[Senate passes the budget bill after all-night session]]></title><link>https://www.npr.org/a</link><pubDate>${rfc(3600_000)}</pubDate><description>&lt;p&gt;The bill now goes to the House &amp;amp; the president.&lt;/p&gt;</description></item>
<item><title>Old story</title><link>https://www.npr.org/old</link><pubDate>${rfc(10 * 86400_000)}</pubDate></item>
</channel></rss>`;
const GOOGLE = `<rss><channel><item><title>Senate passes budget bill after all-night session - AP News</title><link>https://news.google.com/x</link><pubDate>${rfc(2 * 3600_000)}</pubDate><source url="https://apnews.com">AP News</source></item></channel></rss>`;
const ATOM = `<feed><entry><title type="html">NASA rover finds new clue on Mars</title><link rel="alternate" href="https://www.nasa.gov/r"/><updated>${new Date(now - 1800_000).toISOString()}</updated><summary>Rocks hint at ancient water.</summary></entry></feed>`;

describe("feed parsing", () => {
  it("reads RSS items, decodes CDATA, entities and HTML", () => {
    const items = parseFeed(RSS, { name: "NPR News", tier: "public" });
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Senate passes the budget bill after all-night session");
    expect(items[0].summary).toBe("The bill now goes to the House & the president.");
    expect(items[0].source).toBe("NPR News");
  });

  it("uses the outlet from Google News <source> and strips it from the title", () => {
    const [it0] = parseFeed(GOOGLE, { name: "AP News", tier: "wire" });
    expect(it0.source).toBe("AP News");
    expect(it0.title).toBe("Senate passes budget bill after all-night session");
  });

  it("reads Atom entries with href links", () => {
    const [e] = parseFeed(ATOM, { name: "NASA", tier: "specialist" });
    expect(e.link).toBe("https://www.nasa.gov/r");
    expect(e.title).toBe("NASA rover finds new clue on Mars");
  });

  it("reads Wikipedia On This Day events", () => {
    const items = parseOnThisDay({ events: [{ text: "Something documented happened.", year: 1968, pages: [{ content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/X" } }, extract: "Details." }] }] }, { name: "Wikipedia", tier: "reference" });
    expect(items[0].title).toBe("1968: Something documented happened.");
    expect(items[0].link).toMatch(/wikipedia\.org/);
  });

  it("decodes numeric entities", () => {
    expect(decode("Caf&#233; &#x2014; ok")).toBe("Café — ok");
  });
});

describe("ranking", () => {
  it("drops stale items, groups the same event across outlets and ranks it hotter", () => {
    const items = [
      ...parseFeed(RSS, { name: "NPR News", tier: "public" }),
      ...parseFeed(GOOGLE, { name: "AP News", tier: "wire" }),
      ...parseFeed(ATOM, { name: "NASA", tier: "specialist" }),
    ];
    const stories = rankStories(items, "trending", now);
    expect(stories.some((s) => s.title === "Old story")).toBe(false);
    const budget = stories.find((s) => /budget/i.test(s.title))!;
    expect(budget.coverage.map((c) => c.source).sort()).toEqual(["AP News", "NPR News"]);
    expect(budget.source).toBe("AP News"); // wire service leads
    expect(budget.heat).toBeGreaterThan(stories.find((s) => /Mars/.test(s.title))!.heat);
  });
});

describe("genres", () => {
  it("every genre's feeds exist, and there is a Black America genre on Black-press sources", () => {
    for (const g of GENRES) for (const f of g.feeds) expect(FEEDS[f], `${g.id} → ${f}`).toBeDefined();
    const ba = genreById("black_america")!;
    expect(ba.rules).toMatch(/Black press/);
    expect(ba.feeds.filter((f) => FEEDS[f].tier === "black_press").length).toBeGreaterThanOrEqual(8);
  });

  it("covers many genres with unique ids", () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length);
  });
});

describe("video lengths and money", () => {
  it("10-minute vertical video runs on TikTok, Facebook and YouTube; 16:9 long-form on YouTube and Facebook", () => {
    expect(VIDEO_LENGTHS.m10.label).toMatch(/10 minutes/);
    expect(lengthAllowed("m10", "tiktok")).toBe(true);
    expect(lengthAllowed("m10", "facebook")).toBe(true);
    expect(lengthAllowed("m10", "instagram")).toBe(false);
    expect(lengthAllowed("long", "facebook")).toBe(true);
    expect(lengthAllowed("long", "tiktok")).toBe(false);
  });

  it("only Unlimited gets the money stack", () => {
    expect(planById("unlimited").features.moneyStack).toBe(true);
    expect(planById("pro").features.moneyStack).toBe(false);
  });

  it("has a ranking playbook for every platform and a newsroom voice with hard accuracy rules", () => {
    for (const p of PLATFORMS) expect(ALGORITHM_PLAYBOOK[p].length).toBeGreaterThan(40);
    expect(NEWS_LOCK).toMatch(/No invented quotes/);
    const block = storyBlock({ id: "1", genre: "trending", title: "T", summary: "S", link: "https://x.org", source: "NPR", tier: "public", publishedAt: new Date(now - 7200_000).toISOString(), coverage: [{ source: "NPR", link: "https://x.org" }], heat: 50 });
    expect(block).toMatch(/build ONLY from this/);
    expect(block).toMatch(/2 hours ago/);
  });
});
