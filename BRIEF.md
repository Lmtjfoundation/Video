# Nexus Pulse — daily content brief

This branch (`nexus-pulse-content`) is the content inbox for the Nexus Pulse app
(https://nexus-pulse.up.railway.app). A scheduled Claude cloud session writes one batch a day
into `inbox.json`. The app checks this file every 15 minutes and imports every new item as a
**draft** in the owner's account, where she reviews, edits, schedules or renders it.

Each batch also carries a **bank**: 8 extra finished pieces the app keeps in reserve. They are not
shown as drafts. When the owner taps **Generate** and the app's Claude API has no credits, the app
hands out bank pieces for that platform instead of failing.

Items land in the app as drafts. Posts sent to Metricool follow the mode set in "Posting through
Metricool" below (currently `auto`, at the owner's request: they publish on schedule without approval).

---

## The daily run, step by step

1. Read this file, `inbox.json` and `topics.txt`.
2. Write **10 new pieces** in the daily mix and **8 bank pieces** in the bank mix below. Every topic
   must be new: nothing that appears in `topics.txt`, and no hook that echoes a previous one.
   Read "Make it impossible to scroll past" before writing anything.
3. Put them in a new batch at the **start** of `inbox.json` → `batches` (newest first), with the 10
   in `items` and the 8 in `bank`.
   Keep only the **7 newest batches**; delete older ones from the file (the app has already
   imported them; git history keeps them).
   Leave the top-level `series` array exactly as it is (finished episodes of story series such as
   *The Settlement*; the app imports them into Story Studio). Don't edit, reorder or delete it.
4. Append one line per new piece (all 18) to `topics.txt`: `YYYY-MM-DD | platform | topic`.
5. Render the carousel slides (see "Carousel slides"), then run `node validate.mjs`. Fix every error it reports and run it again until it prints `OK`.
6. Commit with the message `Batch YYYY-MM-DD (10 pieces + 8 bank)` and push to
   `nexus-pulse-content`. Never push to any other branch. Never touch the app's code.
7. Follow "Posting through Metricool" below.

Item ids are `YYYY-MM-DD-01` … `-10`; bank ids are `YYYY-MM-DD-B01` … `-B08`, using the run date in
America/Chicago. If a batch with that date already exists, the day is done: stop without changing
anything.

---

## Daily mix (10 pieces)

| # | type  | platform  | format / length | notes |
|---|-------|-----------|-----------------|-------|
| 1 | post  | x         | `short`         | One tweet. hook + body + cta + hashtags must fit in 280 characters total. 0–1 hashtags. |
| 2 | post  | x         | `thread`        | 5–8 tweets in `parts`, each under 270 characters. `parts[0]` is the hook tweet; the last part is the takeaway. |
| 3 | post  | linkedin  | `short`         | 700–1,300 characters. The hook must land in the first ~210 characters. 2–3 hashtags. |
| 4 | post  | linkedin  | `carousel`      | 8–9 slides in `parts`, one idea per slide; `body` is the post text. |
| 5 | post  | facebook  | `short`         | 80–250 words, story-led, ends with one specific question. 0–2 hashtags. |
| 6 | post  | instagram | `carousel`      | 8–10 slides in `parts`; `body` is the caption (first line is the hook). 3–5 hashtags. |
| 7 | video | tiktok    | `s90`           | 61–90 seconds (TikTok only pays creators for videos over 1 minute). |
| 8 | video | instagram | `s60`           | Reel, 45–58 seconds. |
| 9 | video | youtube   | `s60`           | Short, 45–58 seconds. |
| 10| video | facebook  | `s60`           | Reel, 45–58 seconds. |

## Bank mix (8 reserve pieces)

| #   | type  | platform  | format / length | notes |
|-----|-------|-----------|-----------------|-------|
| B01 | post  | x         | `short`         | Same rules as daily #1. |
| B02 | post  | x         | `thread`        | Same rules as daily #2. |
| B03 | post  | linkedin  | `short`         | Same rules as daily #3. |
| B04 | post  | facebook  | `short`         | Same rules as daily #5. |
| B05 | post  | instagram | `carousel`      | Same rules as daily #6. |
| B06 | video | tiktok    | `s90`           | Same rules as daily #7. |
| B07 | video | youtube   | `s60`           | Same rules as daily #9. |
| B08 | video | instagram | `s60`           | Same rules as daily #8. |

Rotate pillars across the 10 pieces in roughly this mix:
wealth_systems 3 · ai_leverage 3 · high_agency 2 · relationships 1 · longevity 1.
Rotate video styles across days (true, funny, explainer, countdown); avoid using the same style
for all four videos in one batch.

---

## Make it impossible to scroll past

The owner wants content that is **exciting and interesting**, not polite and educational. Accuracy
rules below still apply in full — the excitement comes from real stories told well, never from
made-up details.

- **Story first.** At least 6 of the 10 daily pieces (and at least 4 of the 8 bank pieces) are built
  on a real event, person, company, experiment or scandal. The lesson rides inside the story.
- **Cold open on the most dramatic true moment.** Start in the middle of the action, not with
  background. "The vault was empty on Monday morning." beats "In 2003, a group of thieves…".
- **Stakes.** Make it obvious what someone stood to win or lose: money, a career, a reputation, a
  marriage, a company.
- **Hold the twist.** Save the most surprising true fact for the payoff line, slide or scene.
- **Specifics beat summaries.** Names, dates, places, dollar amounts, durations.
- **Story engines that work:** heists and frauds exposed; fortunes made or lost overnight; bitter
  rivalries; spectacular failures and comebacks; absurd-but-true history; the hidden psychology
  companies use on you; experiments with shocking results; "the real reason why…" explainers.
- **Put the reader in it.** Second person and sensory detail where it fits ("You're 26, you just got
  your first real raise, and…" as a clearly framed scenario).
- **Rhythm.** Mix very short lines with longer ones. Line breaks as cliffhangers. No walls of text.
- **Emotion with a point.** Awe, curiosity, outrage at a system (never at a person or group), relief,
  the "wait, what?" laugh. Every piece still leaves one concrete takeaway.
- **No lecture voice.** Never open with "Here are 5 tips", a definition, or a question nobody asked.
- **Hook test.** Before keeping any piece, ask: would a stranger stop scrolling for the first line,
  and would they send it to a friend? If not, rewrite the hook first. Write 3 hooks, keep the best.
- **Titles and thumbnails** promise a specific, true payoff ("He Stole $70M With a Typo" style),
  never a vague one ("You Won't Believe This").
- Avoid clickbait that the content doesn't pay off, and avoid shock for its own sake (gore, tragedy
  as entertainment, mocking victims).

## Retention playbook (finish rate and views come first)

The owner's goal is more views and higher finish rates. Every piece is detailed and engineered so
people stay to the end. All of this is still built from checked facts; detail never means invention.

**Videos**
- **0–1 s:** the first frame is already the most dramatic true moment, with motion and on-screen
  text. Scene 1 narration is 14 words or fewer and contains a number, a name, a date or a money
  amount. No setup, no context, no "today we're talking about".
- **Open a loop in the first 25%:** make the viewer ask a question they need answered ("How does one
  approval lose $1.5 billion?"). Don't answer it until the payoff.
- **Re-hook between 30% and 80%:** a turn, a reveal or a "then it got worse" moment that is true and
  paid off ("But the screen was lying."). Long videos re-hook every 20–30 seconds.
- **Payoff after the re-hook,** then one twist or surprising true fact, then the 2026 line and the
  lesson, then the loop line. Never pad the end; finish on movement.
- **Detail density:** every scene carries at least one concrete detail: a name, number, date, place,
  object, dollar amount, quote or sensory image. Aim for 6+ checkable facts in an `s60` and 8+ in an
  `s90` (all in `factCheck`).
- **Pattern interrupts every 2–4 seconds:** a new visual, camera move, caption style, sound hit or
  number counter. Captions on every line (most people watch muted at first).
- **Stakes stay visible:** a running counter, timer or score on screen when money or time is at
  stake.
- **Speak to one person:** "you" and concrete scenarios, short sentences, no filler words.
- **End-to-start loop:** the last line flows back into the first frame so a replay feels seamless.
- Record the plan in `retention` (see the format below).

**Posts**
- First line: a specific, true, high-stakes moment or number. Second line: why it matters to the
  reader. Then the story in short lines, with names, dates and amounts.
- X threads: 5–8 parts; each part ends on a reason to read the next one. Carousels: 8–10 slides;
  slide 1 is the hook, slide 2 raises the stakes, the last slide is the save-worthy takeaway.
- Every post ends with one concrete thing the reader can do today, and one comment-starting question
  or a save/share cue.

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
- Every scene: `narration` (what is said), `onScreen` (≤ 6 words), `visual` (stock search
  phrase + animated background + character + animation, in the format under "Look, characters
  and 2026"; no real person's likeness, no logos), `motion` (camera move, transition and caption
  animation), `sfx` (a sound effect, or empty).
- A new visual every 2–4 seconds. Open a curiosity loop early and pay it off at the end.
- Keep each scene's narration to about 5–12 words so the picture keeps changing.
- Short videos end on a `loopLine` that flows back into the hook. One specific CTA, never
  "like and subscribe".
- Funny = a real, documented, genuinely absurd event told straight. Never invented jokes or quotes.
- `factCheck` lists every factual claim in the script so the owner can verify before posting.
- Lengths: `s60` = 120–150 words of narration across 12–16 scenes; `s90` = 170–230 words across
  16–22 scenes. Scene `time` values run continuously from `0:00`.
- Niche ids for videos: `finance`, `edu`, `tech`, `health`, `lifestyle` (pick the one that fits).

## Look, characters and 2026 (every video)

The owner wants videos that look like 2026, not like a slideshow of stock clips: animated
characters, animated backgrounds and bold motion graphics, telling stories that feel current.

### Owner cast (the owner edits this list; use it word for word)

Add characters here in plain words: name, role, look, outfit, personality, voice. When this list
has entries, use them as the recurring cast in every video and copy their descriptions word for
word into `cast`. When it is empty, use the autopilot cast below.

- *(empty: add your characters here)*

### Autopilot cast (used when the owner cast is empty)

- **Nova (host)**: an original stylized 3D-animated host, late 20s, warm brown skin, short curly
  hair with mint-green tips, oversized olive bomber jacket over a black tee, small glowing mint
  wrist display. Dry, curious, quick. Voice: warm, crisp, confident, a hint of a smile. Nova
  appears on camera for the 2026 tie-in and the lesson; she never claims to be a real person.
- **Story cast**: for each video, invent original stylized 3D stand-ins for the people in the
  story, built only from documented facts (era, place, job, what they did). Never a real
  person's likeness, face or name on a character design; label them by role ("the trader",
  "the 21-year-old"). No logos or real brand packaging.

### Art direction

- Pick one `artStyle` per video and keep it consistent: stylized 3D animation (soft, glossy,
  cinematic light), 2.5D parallax, retro-cartoon, glitch-pop or newsreel 3D, matched to the
  story's era. Brand accents: mint `#1CD28B` / `#8CF9CB` on near-black `#07080B`.
- Every scene has an animated background (parallax city, drifting particles, light sweeps,
  animated maps, moving charts, UI panels): never a flat colour.
- Motion graphics carry the numbers: counters that spin, charts that draw, glass UI cards,
  kinetic captions that pop word by word.
- Rotate styles across a batch; no two videos in a batch use the same `artStyle`.

### How to write `visual` (the app reads it in two parts)

The app searches stock footage with the text **before the first comma** (it also cuts at `.`,
`;` and `-`, max 80 characters), and falls back to an animated brand gradient. So every scene's
`visual` is:

`<plain stock search phrase, no hyphens>, BG: <animated background>; CHARACTER: <who is on screen and what they do, or "none">; ANIM: <animation and graphics>`

Example: `Trading floor monitors flashing red, BG: dark glossy trading floor with red light sweeps; CHARACTER: the trader, stylized 3D, gripping a desk; ANIM: loss counter spins up, screen glitch`

`motion` names the camera move plus the transition and caption animation (≤ 300 characters).

### 2026 and up to date

- At least one of the four daily videos (and one of the three bank videos) is a documented story
  from 2025 or 2026, verified with web search on the day. The rest can be classic true stories.
- Every video has one spoken 2026 tie-in line near the end that connects the story to how people
  live, work, invest or use AI in 2026. It is framing, not a statistic; any number in it must be
  verified like every other fact.
- Put that line in `angle2026` as well, so the owner can see it at a glance.

### Extra video fields (newest batch)

- `artStyle`: one sentence naming the style, palette and caption look.
- `cast`: list of `{ "name", "role", "look", "voice" }` for everyone who appears on screen.
- `angle2026`: the 2026 tie-in line.
- `retention`: `hookVisual`, `openLoop` {scene, question}, `rehook` {scene, line}, `payoff`
  {scene, line}; scene numbers start at 1 (see "Retention playbook").

The app keeps only the standard fields, so the look must also live inside each scene's `visual`
and `motion`, and the cast's voices inside `voice`.

## Posting through Metricool

The owner's Metricool brand id (blogId) is `7360508`. Metricool is how the daily run can put posts
on her social accounts without each platform's developer app.

**METRICOOL_MODE: auto**

1. After pushing, call Metricool's `getBrandSettings`. If it says no networks are connected (or the
   Metricool tools aren't available), skip this section and say so in your final line.
2. For each connected network among X (`twitter`), LinkedIn and Facebook, take that day's text post
   for it: X = item 01, LinkedIn = item 03, Facebook = item 05. Skip anything else (threads, carousels
   and videos need media or a format Metricool can't take from text alone). Never send bank pieces.
3. Text = hook, body and cta separated by blank lines, then the hashtags with `#`. For X, if that is
   over 280 characters, skip X.
4. Schedule each one with `createScheduledPost` for today (or tomorrow if the slot has passed) at the
   time `getBestTimeToPostByNetwork` suggests, in the brand's timezone. Use
   `"draft": true` when the mode is `drafts` (she approves them in Metricool's planner) and
   `"draft": false, "autoPublish": true` only if the mode above says `auto`.
5. If Instagram is connected, also schedule that day's Instagram carousel (item 06) as an Instagram
   `POST` with its rendered slides (see "Carousel slides") as `media`, in slide order, using
   `https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-content/media/<item id>/slide-N.jpg`
   (the push must have landed first), `mediaAltText` from that folder's `alt.json`, and the caption
   (`body`, then the hashtags with `#`) as text. Same timing and draft rules as step 4.
6. Mention in your final line which posts went to Metricool, or why none did.

## Connected tools (use them every run)

These connectors are attached to the daily run. Use each one as described; if a tool is missing or
errors, skip that step and say so in the final line. Never let a tool step change facts or wording.

- **vidIQ (YouTube titles):** call `vidiq_balance`. If at least 20 credits remain, score the three
  `titles` of that day's YouTube video with `vidiq_score_title` (`type: "short"`), reorder them best
  first, and store `"titleScores": { "vidiq": [..] }` on the item. Costs 5 credits per title; skip
  the step when credits are low. Never score more than one video per day.
- **Canva (editable carousels):** after the push, for each daily carousel (04 and 06) call
  `import-design-from-url` with
  `https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-content/media/<item id>/slides.pdf`,
  name `Nexus Pulse <date> · <topic>` and `intended_design_type: "instagram_post"`. Put the returned
  edit links in the final line so the owner can tweak the slides in Canva.
- **Adobe (Express, Photoshop, Acrobat):** connected with a full account, but not part of the daily
  run. Use it only when the owner asks (for example, Express templates or photo fixes).
- **ElevenLabs and HyperFrames (HeyGen):** not part of the daily run (they spend paid credits; the
  HeyGen free plan allows only a few videos a month). The owner asks for rendered videos separately.

## Carousel slides

Every carousel (daily 04 and 06, bank B05) gets designed slide images the owner can post as-is.

1. Give each carousel item a `slideDesign` object (the app ignores it):
   `{ "tag": "short section label", "accent": "#hex", "glow": "rgba(...)", "slides": [ ... ] }`.
   Slide 1 is the hook. Each slide: `title` (wrap words in `**double asterisks**` to colour them),
   optional `sub`, `tag`, `big` + `size` (font px) and `visual`. Visuals that make the slide graphic:
   - `{ "type": "chart", "points": [["label", value], ...], "show": n, "fmt": "£{v}", "markers": [{ "i": 1, "label": "BUYS BACK", "color": "#E8475A" }], "note": "source note" }`
   - `{ "type": "stat", "value": "£20,000", "label": "..." }`
   - `{ "type": "icons", "items": [["emoji", "label"], ...] }` (3 items)
   - `{ "type": "checklist", "items": ["...", "..."] }`
   - `{ "type": "timeline", "items": [["1886", "5¢", "on"], ...] }`
   - `{ "type": "split", "l": ["label", "text"], "r": ["label", "text"] }`
   - `{ "type": "strike", "text": "a debunked quote" }`
   Use a visual on at least half the slides. Every number in a chart or stat is a checked fact; when
   only some data points are documented, chart only those and add a `note`. Never invent in-between
   values.
2. Render: `npm --prefix tools install --no-audit --no-fund` then `node tools/render-slides.mjs`.
   It writes `media/<item id>/slide-N.jpg` (1080x1350), `alt.json` and `slides.pdf` (used for Canva and
   LinkedIn).
3. Look at the rendered slides (open two or three of the JPGs) and fix anything that overflows or
   reads badly, then commit the `media/<item id>/` folders with the batch.

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
            { "time": "0:00–0:03", "narration": "…", "onScreen": "…", "visual": "stock phrase, BG: …; CHARACTER: …; ANIM: …", "motion": "…", "sfx": "…" }
          ],
          "loopLine": "last line that loops into the hook",
          "factCheck": ["claim to verify"],
          "moneyAngle": "how this video earns",
          "artStyle": "one sentence: style, palette, caption look",
          "cast": [{ "name": "Nova", "role": "host", "look": "…", "voice": "…" }],
          "angle2026": "the spoken 2026 tie-in line",
          "retention": {
            "hookVisual": "what the first frame shows",
            "openLoop": { "scene": 1, "question": "the question the viewer now needs answered" },
            "rehook": { "scene": 8, "line": "the turn or reveal" },
            "payoff": { "scene": 13, "line": "where the open loop is answered" }
          }
        }
      ],
      "bank": [
        { "id": "2026-10-13-B01", "type": "post", "platform": "x", "…": "same fields as items" }
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
