# Ghost Post Autopilot

A subscription SaaS for faceless creators: it finds the niches that pay the most per view, writes retention-built story scripts and platform-native posts, publishes them to six platforms on a schedule, answers comments, and checks every post against each platform's rules so accounts stay in good standing.

Built with Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn-style components, Zustand, Supabase (or a local store) and Stripe. Writing uses the Claude API. Installable on phones as an app, with an iOS/Android shell in `mobile/`.

---

## What it does

| Area | Features |
|---|---|
| **Accounts & admin** | Email + password sign-in with secure sessions. The first account is the admin. Every user's data is separated. Admin console: users, plans, suspend, reset passwords, require approval before a user's posts publish, a review queue to edit/approve/send back any post, revenue and AI-cost overview, sign-up and approval settings. Self-serve account deletion. |
| **Plans & billing** | Free (30 credits) · Creator $15 (400) · Pro $39 (1,000) · Unlimited $99 (3,000) (yearly ≈15% off). **14-day free trial on Pro and Unlimited** (card at checkout, one per account): then a $19 (Pro) or $49 (Unlimited) first month, then the regular price. During the trial, AI writing uses no credits up to a daily allowance (25 credits' worth a day), written by Gemini when you connected a Gemini key (otherwise by Claude); the plan's credits arrive in the vault when the first paid month starts. Unlimited has no post cap and the user sets posts per day. **Credit vault:** credits sit in each account's own vault in lots that expire 30 days after they were added (spent soonest-expiring first); credits that expire unused move to a shared **community pool** that tops up any account that has run out (8 credits a day each, up to 500 a day overall). Credits meter AI writing; post counts, platforms, storage and features are enforced per plan. Stripe Checkout, customer portal and webhooks. |
| **Trend Radar** | Live stories from established newsrooms in 19 genres, refreshed every 30 minutes: Trending now, **Black America** (Capital B, TheGrio, The Root, Word In Black, Black Enterprise, Essence, Andscape, NewsOne, AFRO, BlackPressUSA, plus AP/NPR/PBS coverage), World, Money, Tech & AI, Politics explained (nonpartisan), True crime, Entertainment, Sports, Science & space, Health, History & on this day, Weird but true, Comebacks, Relationships, Mysteries, Gaming, Food, Story time (fiction). Same-event reports are grouped and ranked by freshness and how many outlets cover them. One click turns a story into a post or video; the writer uses only the reporting, credits the outlet, lists the source links on the draft, and (on the app's Claude key) checks details with live web search limited to reliable newsrooms. Each feed's health is shown; the admin can add feeds. |
| **Trend Autopilot** | Every 2 hours it fills the next 6 hours of open posting slots with fresh pieces from live news in the account's genres (text posts on X, Facebook, LinkedIn and webhooks; a video plan for TikTok, YouTube, Instagram and Facebook), optionally renders the videos to MP4, and never repeats a story. Drafts-only mode available. Publishing still follows the Autopilot switch and approval settings. |
| **Video** | Lengths from 25 seconds to **10 minutes** (vertical 10-minute video for TikTok, Facebook and YouTube; 16:9 long-form for YouTube and Facebook). **Faceless** by default (voiceover over stock footage, maps, documents and AI scenes). **Text to video**: paste an article, notes or a script and get a video built only from it, rendered to MP4 in one go. |
| **Reach & money** | Every piece is written with a 1-second hook, open loop, mid-video turn and payoff, plus the published ranking signals of the platform it's for. **Unlimited** adds the Money Stack to every piece: advertiser-friendly language, lengths that qualify for payouts and mid-rolls, search keywords, owned-audience CTA, affiliate fit, sponsor-ready slot, return-viewer hook, pinned comment. No tool can guarantee views; these are the ingredients that give a piece its best chance. |
| **Platforms tab** | One page to link every social account (X, Facebook, LinkedIn, Instagram, YouTube, TikTok, webhook), see what's linked and posting, and switch each one on or off (saves instantly, within the plan's platform limit). Facebook connects as a **Page** (automatic) or as **your own profile**, monetized or not (one-tap posting). |
| **Quick connect (Metricool)** | Accounts already connected in Metricool (Facebook Page, Instagram, X, LinkedIn, YouTube, TikTok) are used with no developer setup: paste the Metricool API token (Account settings → API; Metricool offers API access on its Advanced and Custom plans) and the brand link. Each platform has a "post through Metricool" switch; posts are sent to Metricool's scheduler at their time and Metricool publishes them about 2 minutes later. Platforms connected directly keep posting directly unless switched. Comment replies need a direct connection. |
| **Bring your own AI** | Subscribers don't need a Claude account: the app's built-in Claude is included. In Settings → AI they can instead plug in their own key for Claude, ChatGPT (OpenAI), Google Gemini or OpenRouter (hundreds of models) and pick the model. Keys are stored encrypted per user; everything they generate then runs on their key and uses no credits. |
| **Niche Lab** | Revenue-per-view table for 13 niches from a study of 300 channels' own YouTube Studio data, a revenue calculator, and a Claude research report ranking sub-niches for you with story ideas, a money stack, risks and a 30-day plan. |
| **Story Studio** | Faceless scripts for Shorts, TikTok (>1 min) or 8–10 minute videos: hook, timed scenes, on-screen text, visuals to source, title options, thumbnail text, description and a fact-check list. Upload your notes/transcripts and reference images. Save as a draft post or repurpose to every platform. |
| **Movie Studio** | **Characters from pictures:** upload a photo (with the person's permission) or describe someone, pick an art style (3D animation, anime, comic, watercolor, claymation, photoreal or your own), and Gemini (Nano Banana) draws a character portrait. **Movies and explainers:** describe a story, or paste text to explain, pick the cast, platform and length (30 s – 3 min), and Claude writes a storyboarded script; at render time every scene is pictured with Gemini using the cast's portraits so characters stay the same, the key scenes (0–8, your choice) are animated with **Google Veo 3.1**, and the usual voiceover and captions are added. The result is a normal video post: watch, edit, schedule or post it. Pictures and clips run on the app's Gemini key: a scene picture is 4 credits, a Veo scene 7 credits a second (4–8 s), a character 5 credits; scenes Google declines are refunded. |
| **Explain** | Paste any text (up to 20,000 characters) and get a summary, a plain-language explanation at the level you choose, key points, an example, the terms defined and anything worth double-checking. Copy it, save it as a draft post for any platform, or turn it into an explainer video in Movie Studio. 1 credit (2 over 8,000 characters). |
| **Uploads** | Media library for images and videos (drag and drop), attachable to posts; Instagram uses the attached image through a signed, expiring link. Bulk CSV import of posts. |
| **Platform rules** | Mature (18+) mode for X only: frank but never explicit, needs X's sensitive-media setting confirmed, never auto-published. Blocks mature content elsewhere, duplicate posts within 7 days, and flags engagement bait and platform-specific issues. |
| **Content engine** | Short posts, threads, carousels, video scripts, captions + hooks. Five pillars weighted by advertiser demand. One-click **Maximize money** rewrite. Every output goes through the personality lock and the safety filter. |
| **Scheduling** | 3 posts/day/platform by default (1–6 configurable). Drag-and-drop weekly calendar. **Fill my week** writes and schedules a full week, one day at a time with a progress bar. **AI posting plan** proposes time slots for your audience. Quiet hours. |
| **Auto-posting** | X, LinkedIn and Instagram publish automatically. YouTube and TikTok fall back to **copy-ready** (see the table below). Automatic retries, token refresh for X and YouTube, and late-post protection: a post more than 12 h past its slot is never published. |
| **Auto-engagement** | Fetches new comments (X, Instagram, YouTube). Skips spam, abuse and emoji-only comments. Escalates self-harm signals and possible minors to you. Ranks commenters by reach and substance. Drafts replies in 6 modes: Auto, Quick witty, Deep insight, Supportive, Candid, Value-add. Approval queue is on by default. |
| **Monetization** | Money score (0–100) with the reasons behind it. Revenue estimate based on your own RPM, audience and affiliate numbers. Affiliate offers are attached only when they fit the post, and an FTC disclosure is added automatically. |
| **Safety** | Kill switch. Per-platform caps per hour and per day. Randomized spacing between actions. Exponential back-off after a 429. Duplicate-reply detection. Output blocklist covering financial guarantees, medical claims, trade calls, explicit content and unapproved links. |
| **Records** | Full activity log including the exact text that was posted. Export posts, replies and logs as CSV, Markdown or JSON. |

### What each platform's API actually allows

| Platform | Auto-publish | Auto-reply | Notes |
|---|---|---|---|
| **Facebook** | ✅ Pages (text + video) · 📲 profiles one-tap | ✅ Pages | **Pages** post automatically; posting and replying permissions need Meta App Review before other people can link. **Profiles** (including monetized profiles in professional mode): Meta doesn't let apps post to profiles, so at each post's time it's marked *Ready for you* with the HD video and caption, an email goes out (if email is set up), and the person posts it from `/post/{id}` with one tap (native share sheet → Facebook, caption already copied). No Facebook Login or App Review needed for profiles. |
| **X** | ✅ Posts + threads | ✅ | Posting and reading replies need a paid X API tier for useful volume. Reply monitoring uses recent search (last 7 days). |
| **LinkedIn** | ✅ Text posts | ❌ copy-ready | Reading or replying to comments requires approval for LinkedIn's Community Management API. |
| **Instagram** | ✅ Image posts | ✅ | Requires a Business or Creator account linked to the Graph API. Each post needs a **public https image URL**; text-only posts aren't possible on Instagram. |
| **YouTube** | ❌ copy-ready scripts | ✅ | Video upload isn't automated in this version, and Community posts have no API. Comment replies use the Data API v3 (watch your daily quota). |
| **TikTok** | ❌ copy-ready | ❌ | Direct posting needs an **audited** Content Posting API app; unaudited apps can only post privately. There is no general comment API. |
| **Any app (webhook)** | ✅ JSON to your URL | ❌ | Paste a webhook URL from Zapier, Make, n8n, Slack, Discord or your own server (the Platforms tab). https only, internal addresses blocked, optional HMAC signature (`X-GhostPost-Signature`, signed over `timestamp.body`). Text posts only. "Published" means the receiver accepted it. |

Platform terms and tiers change. Check each developer portal before relying on a feature.

---

## Development and tests

```bash
npm run check     # typecheck + unit tests
npm run build     # production build
```

GitHub Actions runs the same checks plus a build on every push and pull request. Launch steps, store submission and copy live in `docs/` (`LAUNCH_CHECKLIST.md`, `STORE_LISTING.md`, `MARKETING.md`); logo files are in `brand/`.

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
npm run gen:key        # paste the output into ENCRYPTION_KEY
```

### 2. Fill in `.env.local`

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key from console.anthropic.com |
| `ANTHROPIC_MODEL` | | Defaults to `claude-sonnet-5-5` |
| `GEMINI_API_KEY` | | The app's own Gemini key (free trials + backup when Claude can't answer). Can also be pasted in Admin → Integrations |
| `REPLICATE_API_TOKEN` | | Optional. Seedance 2.5 (ByteDance) and the open-weight Wan 2.2 (Alibaba, Apache 2.0) as engines for animated Movie Studio scenes, billed on the Replicate account. Can also be pasted in Admin → Integrations |
| `GEMINI_MODEL` | | Defaults to `gemini-3.8-flash` |
| `GEMINI_IMAGE_MODEL` | | Movie Studio pictures. Defaults to `gemini-nano-banana-2.1`, then `gemini-3.1-flash-image` |
| `VEO_MODEL` | | Movie Studio clips. Defaults to `veo-3.1-fast-generate-preview`, then `veo-3.1-generate-preview` |
| `ENCRYPTION_KEY` | ✅ | Encrypts platform tokens at rest (AES-256-GCM) |
| `APP_URL` | ✅ | Public address of the app (linking, uploads, Stripe return links) |
| `ADMIN_EMAILS` | | Comma-separated emails that always get admin. Otherwise the first sign-up is admin |
| `ANTHROPIC_PREMIUM_MODEL` | | Stronger model for long scripts on Pro and Unlimited (2× credits). Defaults to `claude-opus-5-5` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | to charge | See "Payments" below |
| `CRON_SECRET` | ✅ in production | Protects `/api/cron/*` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | for serverless | Without these, data is stored in `./.data/db.json` |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | for X | Auto-refreshes X's 2-hour access tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for YouTube | Auto-refreshes Google access tokens |
| `META_GRAPH_VERSION`, `META_GRAPH_HOST` | | Instagram Graph API version and host |
| `LINKEDIN_API_VERSION` | | `YYYYMM`; blank means a recent version is chosen automatically |
| `WORKER_INTERVAL_MINUTES` | self-hosting | Used by `npm run worker` |

### 3. Database (Supabase, optional locally)

Open Supabase, go to SQL Editor, and run `supabase/schema.sql`. Row Level Security is enabled with no policies, so only the server's service-role key can read the data.

### 4. Run, and create the admin account

```bash
npm run dev            # http://localhost:3000
```

Open the app and sign up. **The first account becomes the admin** on the Unlimited plan. Everyone after that signs up on Free (you can close sign-ups or require approval in Admin → App settings).

On a public server, set `SETUP_CODE` (any secret phrase). The sign-up page then asks for it before creating the first (owner) account, so nobody else can claim a freshly deployed site. Later sign-ups don't need it.

### Integrations (paste keys in the app)

Admin → App settings → **Integrations** stores service keys encrypted on the server (AES-256-GCM with `ENCRYPTION_KEY`), shows only masked previews, and has a **Test** button for each:

| Service | Used for | Required? |
|---|---|---|
| Claude (Anthropic) | niches, posts, scripts, video plans, replies. News pieces use Claude's **web search** tool (limited to reliable newsrooms) when it's enabled for your organization in the Claude Console; Anthropic bills searches separately, and the app falls back to the feed reporting when it's off | yes |
| Gemini (Google) | **the app's own Gemini key, so subscribers never need an AI account:** free-trial accounts write with it, and it steps in automatically whenever Claude can't answer (no credits, key rejected, overloaded). Two switches: "Free trials write with Gemini" and "Use Gemini as the backup". Posts that need Claude's live web search stay on Claude. Use a key from a Google Cloud project **with billing on**: on Google's free tier, prompts and answers may be used to improve Google's products and daily limits are small. Default model `gemini-3.8-flash` (change it on the card). The same key powers **Movie Studio** pictures (Nano Banana) and animated scenes (Veo 3.1). Content quality differs from Claude, so compare a few posts before relying on it | optional |
| ElevenLabs | voiceover on rendered videos | optional |
| Pixabay (or Pexels) | stock footage for video scenes | optional |
| Resend | "Forgot password?" emails | optional (needs a domain verified in Resend) |
| Stripe | subscriptions | to charge money |

Environment variables (e.g. `ANTHROPIC_API_KEY`) work as defaults: a key saved in the app takes priority, so you can always replace a key from the app. Personal Claude keys that aren't tied to one workspace also need the workspace ID (Claude Console → Settings → Workspaces → ID, starts with `wrkspc_`) — there's a field for it, or set `ANTHROPIC_WORKSPACE_ID`.

### Payments (Stripe) — one click

1. In Stripe → Developers → API keys, copy the **secret key** (`sk_test_…` to try it with test cards, `sk_live_…` to take real money).
2. In the app: Admin → App settings → Integrations → Stripe → paste it → **Connect Stripe & create plans**. The app then, in your Stripe account:
   - creates the Creator, Pro and Unlimited products with monthly and yearly USD prices from `src/lib/plans.ts` ($15/$156, $39/$396, $99/$1,008),
   - registers the webhook `{APP_URL}/api/stripe/webhook` (checkout + subscription events) and stores its signing secret,
   - sets up the Customer Portal (switch plans, update card, invoices, cancel at period end) with your Terms and Privacy links.
   - creates the trial coupons: "Pro: first month $19" and "Unlimited: first month $49" (one month of discount from the day the subscription starts, so it covers the invoice at the end of the 14-day trial and nothing after). **If you connected Stripe before trials were added, press the button once more** so the coupons exist; until then the 14 free days still work and the pricing page shows the regular price after the trial.
3. Running it again is safe: existing products and prices are reused. To go live, activate your Stripe account, paste the `sk_live_` key and press the button again.

Test card in test mode: `4242 4242 4242 4242`, any future date, any CVC.

Prefer environment variables? `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_<PLAN>_<MONTHLY|ANNUAL>` still work as defaults; values saved by "Connect Stripe" take priority.

Until Stripe is set up, paid plans show "Coming soon" and you can assign plans by hand in Admin → Users.

### Legal pages

`/terms` (with the refund policy), `/privacy` and `/data-deletion` are public and use the business name, support email and governing law you set in Admin → App settings. Stripe asks for these links when you activate payments, and Meta, Google, X, LinkedIn and TikTok ask for them in app review. They're a solid starting point, not legal advice — have them reviewed for your business.

**Why these prices:** comparable tools charge $15–$29 to start (OpusClip $15, AutoShorts $19, Later $25, SocialBee $29) and usually cover only video, or only scheduling. Each Ghost Post credit costs about 2¢ of Claude usage (1.6–2.2¢, measured from the app's prompt sizes at Claude Sonnet 5.5 prices). Priced at $15 / $39 / $99, every paid plan stays profitable even if a subscriber uses every credit: about 42% / 45% / 36% gross margin on monthly billing in that worst case (35% / 36% / 26% on yearly), and above 60% at a typical half usage, after card fees (hosting, voice and render compute not included). The community pool only moves credits somebody already paid for, so it never raises total usage above the credits sold. Admin → Overview shows your MRR, an estimated AI cost, the credits sitting in vaults and the pool balance. Competitor list prices checked Oct 2026: SocialBee $29/$49/$99, Later $25/$50/$110, Metricool $25/$67, ContentStudio $19/$49/$99, SocialPilot $20/$40/$100.

### 5. Link your accounts (the Platforms tab)

Each platform card (X, Facebook, LinkedIn, Instagram, YouTube, TikTok) has a **Connect with …** button. It sends you to the platform's own sign-in page, you approve the permissions there, and you come back already linked. The app never sees your password. It stores only the access token, encrypted, and refreshes it automatically where the platform allows.

The button only appears after a **one-time setup** that you, the owner, do per platform. Your subscribers never do this; they only press Connect.

**Easiest way: the Setup Wizard.** On each card that isn't set up yet, press **Set up … step by step**. It walks you through the platform's developer portal with direct links, gives you **Copy** buttons for the exact redirect URL and permissions to paste, and has two boxes for the app ID and secret. Press **Save and enable Connect** and the button goes live. Keys are stored encrypted, so there's no file to edit and no restart.

If you prefer environment variables (for example on Vercel), put the same values in `.env.local`. Environment variables take priority over keys saved in the wizard.

| Platform | Where to register | Redirect URL to add | Env vars |
|---|---|---|---|
| X | developer.x.com → app → User authentication → OAuth 2.0, Web App | `{APP_URL}/api/connect/x/callback` | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| Facebook | developers.facebook.com → Business app → add *Facebook Login for Business* | `{APP_URL}/api/connect/facebook/callback` | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| LinkedIn | linkedin.com/developers → add *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect* | `{APP_URL}/api/connect/linkedin/callback` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Instagram | developers.facebook.com → app with *Instagram API with Instagram Login* (Business or Creator account) | `{APP_URL}/api/connect/instagram/callback` | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` |
| YouTube | console.cloud.google.com → OAuth client (Web application), YouTube Data API v3 enabled | `{APP_URL}/api/connect/youtube/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| TikTok | developers.tiktok.com → app with Login Kit and Content Posting API | `{APP_URL}/api/connect/tiktok/callback` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |

Set `APP_URL` to the address people use to reach the app (for example `https://pulse.yourdomain.com`). Each redirect URL must match it exactly. Until a platform is registered, its card shows these setup steps instead of the button.

What each link asks for, and how long it lasts:

- **X**: read profile and posts, publish posts, stay connected. Uses PKCE; the 2-hour token refreshes automatically.
- **Facebook**: the Pages you manage, posting as a Page, reading and replying to comments. Page tokens don't expire on a timer. If you manage several Pages, the Facebook card lets you choose which one to post as. Apps can only post to Pages, not personal profiles.
- **LinkedIn**: name and photo, publish posts. Tokens last 60 days. Only apps LinkedIn enables for refresh tokens renew on their own; others show a "Reconnect by" date.
- **Instagram**: profile, publishing, comments. The 60-day token is refreshed automatically when 10 days remain.
- **YouTube**: your channel and its comments. Refreshes automatically.
- **TikTok**: display name, and sending videos to your drafts. Refreshes automatically. Posting straight to the profile needs TikTok's app audit.

**Platform review:** most platforms let you link your own account during development. To let *other people* link theirs (for example paying subscribers), each platform requires app review: Meta App Review (Facebook and Instagram), TikTok audit, Google OAuth verification for YouTube scopes, and LinkedIn product approval. Plan for this before launch.

**Advanced:** each card also has *Paste a token instead*, for tokens you generate yourself in a developer portal.

### 6. Turn on the scheduler

Something has to call `/api/cron/publish` (every 5 min) and `/api/cron/engage` (every 15 min) with `Authorization: Bearer $CRON_SECRET`. Pick one option:

- **Vercel**: `vercel.json` already defines both crons, and Vercel sends `CRON_SECRET` automatically. Sub-daily crons need a paid Vercel plan. Long routes set `maxDuration` up to 300 s; lower this if your plan has a smaller cap.
- **Your own server**: run `npm run build && npm start`, then in a second process run `APP_URL=… CRON_SECRET=… npm run worker`.
- **Any external cron service** (cron-job.org, GitHub Actions, etc.): send a GET to both URLs with the bearer header.

Then flip **Autopilot posting** (and, if you want it, **Auto-engagement**) on in the Command Center.

---

## Video posts: render and auto-upload

1. **Generate → Video post** writes a production plan (scenes, narration, on-screen text, visuals).
2. **Render video** turns the plan into a finished MP4 on your server (1080×1920 for Shorts/Reels/TikTok, 1920×1080 for YouTube long-form):
   - Voiceover: ElevenLabs text-to-speech per scene when `ELEVENLABS_API_KEY` is set; otherwise captions-only.
   - Visuals per scene: your attached images/clips (Ken Burns motion), else Pixabay stock footage matched to the scene (`PIXABAY_API_KEY`, Pexels as a second source), else animated gradients.
   - Captions: on-screen headline + word-group captions burned in.
   - Needs ffmpeg on the server — on Railway set `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg`.
3. **Post now / schedule** uploads the MP4 automatically:
   | Platform | How | Notes |
   |---|---|---|
   | X | Media upload API (chunked) → post with video | Needs `media.write` scope — reconnect X after updating |
   | Facebook Page | Page video upload by URL | |
   | Instagram | Reels container → publish | Reels 3 s–15 min |
   | LinkedIn | Videos API → post with video | |
   | YouTube | Resumable upload (Shorts for vertical) | Needs `youtube.upload` — reconnect YouTube. Apps that haven't passed Google's API audit have uploads locked to private. |
   | TikTok | Upload to the creator's TikTok inbox (drafts) | The creator taps Post in TikTok. Public direct posting needs TikTok's app audit. |

## Go live on an Azure VM (what Ghost Post runs on)

The app runs on its own always-on VM; the engines run on VMs that start when used and stop themselves when idle.

| Machine | Size | What it does | Billed |
|---|---|---|---|
| GhostApp | D4ads v7 (4 vCPU, 16 GB), regular | the website, database folder, scheduler | always ($0.228/h ≈ $166/month) |
| Ghost | D2nlds v6, Spot | tools engine: upscale, background removal, voice isolation | only while on ($0.0295/h) |
| GhostGPU | NV36ads A10 v5 (one A10, 24 GB) | pictures, clips, voices, lip sync, writing | only while on ($3.20/h) |

1. **App:** on an Ubuntu 24.04 VM with ports 80 and 443 open, run
   `curl -fsSL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/deploy/azure-app/install.sh | sudo bash`
   (add `-s -- --migrate-from https://your-old-address` to move an existing Ghost Post). It serves
   `https://ghostpost.<ip>.sslip.io` and deploys new commits of the branch by itself every 2 minutes.
2. **Moving from another server:** on the old one, Admin → App settings → **Move to a new server** → Make a move code;
   on the new one open `/restore` and paste it. Everything (accounts, posts, uploads, settings and keys) is copied server
   to server, and the old address then sends everyone to the new one and stops its scheduler. Afterwards press
   **Connect Stripe** on the new server (it points Stripe's webhook at the new address) and add the new
   `APP_URL/api/connect/<platform>/callback` redirect URLs in each platform's developer settings.
3. **Engines:** `engine/azure/deploy.sh` (GPU: `SIZE=Standard_NV36ads_A10_v5 QUALITY=fast`) or `engine/azure/install.sh --cpu`.
   Each engine VM deallocates itself after 20 idle minutes (`engine/azure/idle-stop.sh`); Ghost Post starts it again with
   its wake line (Admin → Integrations). GPU sizes need GPU quota, which a Free Trial subscription can't get: upgrade to
   Pay-As-You-Go first.
4. **Costs:** Admin → Overview → Profit & operating costs shows this month's profit after card fees, AI, engine hours and
   servers. Put your real bills there.

## Go live on Railway (one always-on server)

Railway runs the app as an always-on server, so the built-in scheduler posts on time without extra cron services.

1. Create an account at railway.com and start a **new project → Deploy from GitHub repo** (push this folder to a private GitHub repo first) or use the Railway CLI: `railway up` from this folder.
2. Add a **Volume** to the service, mounted at `/data`. This keeps your database and uploads when the app redeploys.
3. In the service's **Variables**, add:
   - `SETUP_CODE` — a secret phrase; the first sign-up must enter it to become the owner
   - `APP_URL` — your Railway URL, e.g. `https://ghost-post-autopilot.up.railway.app` (Settings → Networking → Generate Domain; you can rename the subdomain there)
   - `ENCRYPTION_KEY` — run `npm run gen:key` (or any 32+ random characters)
   - `CRON_SECRET` — any long random string
   - `INTERNAL_SCHEDULER` = `1`
   - `DATA_DIR` = `/data`
   - Optional: `ANTHROPIC_API_KEY` and the other service keys (or paste them later in Admin → App settings → Integrations), Supabase (instead of the volume), platform app keys (or enter those in the app's Setup Wizard).
4. Deploy. Open the URL, sign up with the setup code, add your Claude key and connect Stripe in **Admin → App settings**, then go to **the Platforms tab** and use the Setup Wizard for each platform.
5. Each platform's redirect URL is shown in the wizard: `APP_URL/api/connect/<platform>/callback`.

## Daily batch from Claude (content inbox)

Drafts can also arrive without any Claude API credits. A scheduled Claude cloud session writes a batch of
posts and video plans each day to `inbox.json` on the `nexus-pulse-content` branch of this repo (see
`BRIEF.md` on that branch). Every 15 minutes the built-in scheduler calls `/api/cron/inbox`, which imports
new items as **drafts** in the owner's account, tagged "Daily batch". Nothing is published without review.

- `CONTENT_INBOX_URL`: raw URL of the inbox file (default: the `nexus-pulse-content` branch of Lmtjfoundation/Video)
- `CONTENT_INBOX_OWNER`: email of the account that receives the drafts (default: the first admin)
- `CONTENT_INBOX=off`: turns the importer off

**Story series.** The inbox can also carry a top-level `series` array of finished, voiced episodes (for example
*The Settlement*). Each episode's script goes to **Story Studio** (format "Series episode", labeled fiction, with
an in-app player), and Instagram and Facebook **video drafts** are created with the finished MP4 attached. The
video stays on GitHub until you publish; then it is stored once in the Media Library (the server keeps at least
150 MB free) and uploaded like any rendered video. Only https `.mp4` links on `raw.githubusercontent.com` (or the
inbox's own host) are accepted.

## Mobile app

- **Installable now:** on a phone, open your app's address and choose *Add to Home Screen* (iPhone) or *Install app* (Android). It runs full-screen with a bottom tab bar.
- **App Store / Google Play:** `mobile/` contains a Capacitor shell that loads your hosted app. See `mobile/README.md` for build steps and store rules (subscriptions are sold on the web; the native app hides purchase buttons).

---

## Daily use

1. **Studio**: generate posts, read the money score and its notes, edit, press *Maximize money*, then schedule or post now.
2. **Calendar**: *Fill my week with max-money content*. Drag posts between days, and click any card to edit or reschedule it.
3. **Engagement**: review drafted replies, rewrite them in another mode, approve them one at a time or all at once, then send. Check the *Escalated* tab yourself.
4. **Activity Log**: see everything the agent did, with full details. Export it whenever you need to.
5. **Kill switch**: stops all posting and replying immediately.

**Recommended rollout:** leave *Approve replies first* on for 1–2 weeks. Read what the agent drafts and refine the creator notes in Settings → Voice. Only switch to fully automatic replies once you trust the output.

---

## Honest notes

- **No tool can guarantee an account won't be restricted.** This app follows each platform's official API, posts at human cadence, stays under conservative caps you control, and backs off when told to. Follow each platform's automation and spam policies, and on X label the account as automated if its rules require it.
- **Revenue numbers are estimates.** They come from *your* inputs (RPM, reach, CTR, conversion and commission). They are useful for comparing posts, not as income forecasts. The pillar weights reflect relative advertiser demand (finance and B2B/AI software usually rank highest); real CPMs vary by platform, country, season and audience.
- **No explicit content.** The app never writes sexually explicit content (Claude won't, and Anthropic's usage policy doesn't allow it). Mature mode is X-only and non-explicit; X allows labeled adult content but restricts its monetization, and every other platform removes or demonetizes it.
- **Disclosure.** Promoted posts automatically include your disclosure text. The agent never claims to be human, and if someone sincerely asks, it says honestly that it is AI-assisted.
- **Posting times** are starting points from public studies. Use your own analytics after a few weeks.

---

## Project structure

```
src/
  app/
    page.tsx               Command Center (toggles, kill switch, usage, activity)
    login/ signup/ pricing/  Public pages
    niche/ stories/ studio/ calendar/ media/ engage/ logs/ plans/ settings/ admin/
    api/
      auth/{signup,login,logout,me,password,delete}
      admin/{users,content,stats,settings}
      billing/{checkout,portal}, stripe/webhook, plans
      niche, stories, stories/to-post, repurpose, import, media, media/file/[owner]/[id]
      generate, rewrite, posts, posts/publish
      schedule/fill, schedule/plan
      replies, replies/regenerate, engage/run, engage/send
      settings, credentials, status, logs, export
      cron/publish, cron/engage        ← scheduler entry points
  components/  ui.tsx (Button, Card, Switch, ScoreRing…), shell.tsx, post-card.tsx
  lib/
    personality.ts   Personality lock + pillar and reply-mode briefs
    generate.ts      Content engine + "Maximize money" rewrite
    scheduler.ts     Week filling + AI posting plan
    publisher.ts     Due-post publishing with retries and back-off
    engage.ts        Comment triage, ranking, reply drafting, sending
    safety.ts        Comment classifier + output filter
    ratelimit.ts     Caps, spacing, quiet hours, cooldowns
    scoring.ts       Money score + revenue estimate
    compose.ts       Platform-specific rendering (threads, limits, disclosure)
    platforms/       X, LinkedIn, Instagram, YouTube, TikTok adapters + token refresh
    db.ts            Multi-user storage: every row is owned by a user; per-user scoping is automatic
    auth.ts          Accounts, sessions, login throttling, credits and post allowances
    plans.ts         Plans, prices, limits and credit costs
    billing.ts       Stripe checkout, portal, webhook verification
    admin.ts         Admin console actions
    compliance.ts    Platform rules engine (mature mode, duplicates, platform-specific checks)
    niches.ts stories.ts   Sourced niche data, niche research, story scripts, repurposing
    media.ts         Uploads (local disk or Supabase Storage) with signed links
    repo.ts crypto.ts      Data access, encrypted credentials
scripts/worker.mjs   Self-hosted scheduler loop
mobile/              Capacitor iOS/Android shell
public/              PWA service worker and app icons
supabase/schema.sql
```

## Customizing

- **Voice:** `src/lib/personality.ts` for the core, Settings → Voice for creator notes.
- **Safety rules:** `src/lib/safety.ts`.
- **Money weights:** `PILLAR_DEMAND` in `src/lib/scoring.ts` and the content mix in Settings.
- **New platform:** add a spec in `platforms/specs.ts` and an adapter in `platforms/adapters.ts`.
