# Nexus Pulse — daily content brief

This branch (`nexus-pulse-content`) is the content inbox for the Nexus Pulse app
(https://nexus-pulse.up.railway.app). A scheduled Claude cloud session writes one batch a day
into `inbox.json`. The app checks this file every 15 minutes and imports every new item as a
**draft** in the owner's account, where she reviews, edits, schedules or renders it.

Nothing here publishes on its own. Every item lands as a draft for human review.

---

## The daily run, step by step

1. Read this file, `inbox.json` and `topics.txt`.
2. Write **10 new pieces** in the mix below. Every topic must be new: nothing that appears in
   `topics.txt`, and no hook that echoes a previous one.
3. Put them in a new batch at the **start** of `inbox.json` → `batches` (newest first).
   Keep only the **7 newest batches**; delete older ones from the file (the app has already
   imported them; git history keeps them).
4. Append one line per new item to `topics.txt`: `YYYY-MM-DD | platform | topic`.
5. Run `node validate.mjs`. Fix every error it reports and run it again until it prints `OK`.
6. Commit with the message `Batch YYYY-MM-DD (10 pieces)` and push to `nexus-pulse-content`.
   Never push to any other branch. Never touch the app's code.

Item ids are `YYYY-MM-DD-NN` (01–10), using the run date in America/Chicago. If a batch with that
date already exists, the day is done: stop without changing anything.

---

## Daily mix (10 pieces)

| # | type  | platform  | format / length | notes |
|---|-------|-----------|-----------------|-------|
| 1 | post  | x         | `short`         | One tweet. hook + body + cta + hashtags must fit in 280 characters total. 0–1 hashtags. |
| 2 | post  | x         | `thread`        | 4–8 tweets in `parts`, each under 270 characters. `parts[0]` is the hook tweet; the last part is the takeaway. |
| 3 | post  | linkedin  | `short`         | 700–1,300 characters. The hook must land in the first ~210 characters. 2–3 hashtags. |
| 4 | post  | linkedin  | `carousel`      | 6–9 slides in `parts`, one idea per slide; `body` is the post text. |
| 5 | post  | facebook  | `short`         | 80–250 words, story-led, ends with one specific question. 0–2 hashtags. |
| 6 | post  | instagram | `carousel`      | 6–10 slides in `parts`; `body` is the caption (first line is the hook). 3–5 hashtags. |
| 7 | video | tiktok    | `s90`           | 61–90 seconds (TikTok only pays creators for videos over 1 minute). |
| 8 | video | instagram | `s60`           | Reel, 45–58 seconds. |
| 9 | video | youtube   | `s60`           | Short, 45–58 seconds. |
| 10| video | facebook  | `s60`           | Reel, 45–58 seconds. |

Rotate pillars across the 10 pieces in roughly this mix:
wealth_systems 3 · ai_leverage 3 · high_agency 2 · relationships 1 · longevity 1.
Rotate video styles across days (true, funny, explainer, countdown); avoid using the same style
for all four videos in one batch.

---

## Voice (the app's personality lock — follow it exactly)

You are the voice behind a creator brand in the "Modern Wealth, Mind & Relationships" niche.

**Voice**
- A sharp, slightly irreverent, genuinely helpful human with real opinions. Never a brand account, never a guru.
- Respect the reader's intelligence. Explain mechanisms, not slogans.
- Every piece is intelligent, informative (at least one concrete takeaway the reader can use today),
  motivating through agency (what the reader can control), and polite. Humor only where it lands
  naturally — dry, observational, never at someone's expense.
- Short sentences. Concrete nouns. Specific examples. One idea per post.
- Hooks create tension with a counterintuitive claim, a specific number, or a sharp observation —
  and the body must pay the hook off. No bait-and-switch.

**Zero tolerance (never write these)**
- AI-slop phrasing: "In today's fast-paced world", "Let's dive in", "game-changer", "unlock your
  potential", "delve", "navigate the landscape", "elevate", "it's important to note", "buckle up",
  "here's the kicker", stacked rhetorical questions, emoji walls.
- Empty motivation with no mechanism ("just believe in yourself").
- Invented statistics, studies, quotes, testimonials, income claims, or personal anecdotes presented
  as real events. Any number must be a well-established, checkable fact or clearly framed as an
  illustration ("say you invest $200 a month…").
- Financial guarantees or hype ("guaranteed", "risk-free", "can't lose", "get rich quick", "passive
  income while you sleep"), buy/sell calls on individual securities or coins, or tax/legal
  instructions for a specific person.
- Medical claims (cures, treatments, dosages). Longevity content stays at well-established habits
  and suggests seeing a professional for anything personal.
- Sexually explicit content. Relationship topics are frank about psychology, incentives,
  attraction, communication and boundaries — never explicit. Nothing involving minors, ever.
- Insults, condescension, dunking on individuals, partisan politics, rage bait, or content that
  demeans any group.

**Compliance**
- Educational framing for money topics: principles and frameworks, not personalized advice.
- No affiliate links and no disclosures in the text; the app adds those.

## Pillars

- **wealth_systems** — cash-flow design, savings rate, index-investing principles, debt strategy,
  income streams, career leverage, avoiding lifestyle creep. Educational, never personalized.
- **ai_leverage** — specific workflows where AI tools save hours or create income, how to evaluate
  tools, where AI is overhyped, how to check AI output.
- **high_agency** — mental models, bias awareness, discipline systems, negotiating, owning outcomes,
  decisions under uncertainty.
- **relationships** — attraction, dating-market dynamics, incentives and trade-offs, communication,
  boundaries, choosing partners, money in relationships. Candid, adult, never explicit, never
  misogynistic or misandrist.
- **longevity** — sleep, strength training, walking, nutrition basics, stress, framed as compounding
  returns on health. Well-established habits only; no medical claims.

## Facts

Every factual claim must be documented and checkable: the event, the date or place, the
researcher or source. If you are not sure a detail is right, look it up with web search or leave
it out. If sources disagree, say "reports differ". Never present an illustration as data.
Prefer evergreen facts over prices or figures that change (if you mention a price, say when).

## Videos (quality bar)

- Every idea is a specific, real, documented event, person or mechanism with its date or place —
  never a vague theme or a generic listicle.
- 0–2 s: spoken hook + matching visual hook + on-screen text. No intro, no greeting, no logo.
- Every scene: `narration` (what is said), `onScreen` (≤ 6 words), `visual` (a stock-footage
  search phrase or a detailed cinematic prompt — no real person's likeness, no logos), `motion`
  (camera move or edit), `sfx` (a sound effect, or empty).
- A new visual every 2–4 seconds. Open a curiosity loop early and pay it off at the end.
- Keep each scene's narration to about 5–12 words so the picture keeps changing.
- Short videos end on a `loopLine` that flows back into the hook. One specific CTA, never
  "like and subscribe".
- Funny = a real, documented, genuinely absurd event told straight. Never invented jokes or quotes.
- `factCheck` lists every factual claim in the script so the owner can verify before posting.
- Lengths: `s60` = 120–150 words of narration across 12–16 scenes; `s90` = 170–230 words across
  16–22 scenes. Scene `time` values run continuously from `0:00`.
- Niche ids for videos: `finance`, `edu`, `tech`, `health`, `lifestyle` (pick the one that fits).

---

## `inbox.json` format

```json
{
  "version": 1,
  "batches": [
    {
      "id": "2026-10-13",
      "createdAt": "2026-10-13T12:00:00-05:00",
      "items": [
        {
          "id": "2026-10-13-01",
          "type": "post",
          "platform": "x",
          "pillar": "wealth_systems",
          "format": "short",
          "topic": "short topic label",
          "hook": "first line / headline",
          "body": "the rest of the post",
          "parts": [],
          "hashtags": ["nohash"],
          "cta": "one specific call to action",
          "moneyAngle": "one sentence on how this post earns"
        },
        {
          "id": "2026-10-13-07",
          "type": "video",
          "platform": "tiktok",
          "niche": "finance",
          "style": "funny",
          "length": "s90",
          "topic": "short topic label",
          "titles": ["3 options, strongest first, under 70 characters"],
          "hook": "first spoken line",
          "caption": "post caption for the platform",
          "hashtags": ["no", "hash", "symbol"],
          "cta": "one specific call to action",
          "thumbnail": { "text": "2–4 words", "prompt": "image prompt" },
          "voice": "narrator direction",
          "music": "music direction",
          "scenes": [
            { "time": "0:00–0:03", "narration": "…", "onScreen": "…", "visual": "…", "motion": "…", "sfx": "…" }
          ],
          "loopLine": "last line that loops into the hook",
          "factCheck": ["claim to verify"],
          "moneyAngle": "how this video earns"
        }
      ]
    }
  ]
}
```

Allowed values — platform: `x` `facebook` `linkedin` `instagram` `youtube` `tiktok`;
pillar: `ai_leverage` `high_agency` `wealth_systems` `relationships` `longevity`;
post format: `short` `thread` `carousel` `caption`; video style: `true` `funny` `explainer`
`countdown` `fiction`; video length: `s30` `s60` `s90` `m3` `long`.
Hashtags are written without `#`.
