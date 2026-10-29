import Link from "next/link";
import type { Metadata } from "next";
import { Activity, CalendarClock, Clapperboard, Film, Image as ImageIcon, Mic, Music2, Sparkles, UserRound, Wand2, Workflow } from "lucide-react";
import { PricingTable } from "@/components/pricing";
import { LegalFooter } from "@/components/legal-footer";
import { AdPlayer } from "@/components/ad-player";
import { plansPayload } from "@/lib/plans-public";

export const dynamic = "force-dynamic";

const TITLE = "Ghost Post: your whole AI studio in one app";
const DESCRIPTION = "Pictures, videos, voices, music and sound effects made by Ghost Post's own AI, then posted to TikTok, Instagram, YouTube and Facebook for you. Start free, no card needed.";

export async function generateMetadata(): Promise<Metadata> {
  const base = (process.env.APP_URL || "https://ghostpost.eastus.cloudapp.azure.com").replace(/\/$/, "");
  const image = `${base}/promo/ad-2026-share.jpg`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${base}/welcome` },
    openGraph: { type: "website", url: `${base}/welcome`, title: TITLE, description: DESCRIPTION, siteName: "Ghost Post", images: [{ url: image, width: 1200, height: 630 }], videos: [{ url: `${base}/promo/ad-2026-web.mp4`, type: "video/mp4", width: 720, height: 1280 }] },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [image] },
  };
}

/** Everything in the gallery was made with Ghost Post's own tools (scripts/make-ad.py has the prompts). */
const GALLERY = [
  { src: "/promo/showcase/h2.jpg", tool: "Story to Video", line: "A true story, painted scene by scene" },
  { src: "/promo/showcase/h1.jpg", tool: "Story to Video", line: "Dresden, November 2019: the power goes out" },
  { src: "/promo/showcase/h3.jpg", tool: "Story to Video", line: "The getaway car, set on fire" },
  { src: "/promo/showcase/c0.jpg", tool: "Characters", line: "Make a character once…" },
  { src: "/promo/showcase/c1.jpg", tool: "Characters", line: "…the same face in the city" },
  { src: "/promo/showcase/c2.jpg", tool: "Characters", line: "…on a mountain at sunrise" },
  { src: "/promo/showcase/c3.jpg", tool: "Characters", line: "…and in the studio" },
];

const STEPS = [
  { n: "1", title: "Create", text: "Describe a picture, a story or a song. Ghost Post makes it: scenes, motion, voice, music and captions." },
  { n: "2", title: "Polish", text: "Change any scene, keep your characters the same, swap in your own voice, pick the music." },
  { n: "3", title: "Post", text: "Connect your accounts once. Ghost Post writes the captions and posts at the best times, every day." },
];

/** The studio, tool by tool: each with a screen from the real app (public/promo/studio, taken from a demo account). */
const STUDIO = [
  { icon: ImageIcon, title: "Image Studio", shot: "/promo/studio/images.jpg", text: "Make pictures from a sentence, edit them by describing the change, upscale them, cut out the background, and place your characters into any scene." },
  { icon: Clapperboard, title: "Story to Video", shot: "/promo/studio/story-video.jpg", text: "An idea, a script, a recording or a web page becomes a narrated video with pictures, music and captions, in 23 languages." },
  { icon: UserRound, title: "Characters", shot: "/promo/studio/characters.jpg", text: "Make a character once from a photo or a description. The same face, hair and outfit in every scene, episode and film." },
  { icon: Mic, title: "Voice Lab", shot: "/promo/studio/voice-lab.jpg", text: "Lifelike voices with emotion, voices designed from a description, your own cloned voice, dubbing, transcripts, a voice isolator, and your recording in place of the AI voice." },
  { icon: Music2, title: "Music & sound effects", shot: "/promo/studio/create.jpg", text: "Songs and instrumentals in any style, sound effects, footage and a library with a license that covers commercial use." },
  { icon: Film, title: "Movie Studio & Film Engine", shot: "/promo/studio/movies.jpg", text: "Short films and series with animated scenes, a cast that stays consistent, dialogue, a score and an edit room." },
  { icon: Workflow, title: "Director, Flows & Video Tools", shot: "/promo/studio/director.jpg", text: "Chat with a director that plans your video, chain tools into one-click flows, and use smart shots, music videos and lip-sync avatars." },
  { icon: CalendarClock, title: "Autopilot posting", shot: "/promo/studio/calendar.jpg", text: "A calendar that fills itself: captions written for each network, posted to TikTok, Instagram, YouTube, Facebook, X and LinkedIn." },
];

export default async function WelcomePage() {
  const initial = await plansPayload();
  return (
    <div className="relative z-10 mx-auto max-w-[1200px] px-4 py-8 sm:px-5 sm:py-12">
      <header className="mb-10 flex items-center justify-between gap-3">
        <Link href="/welcome" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500"><Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} /></span>
          <span className="font-semibold text-white">Ghost Post</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          <a href="#plans" className="hidden rounded-lg px-3 py-2 text-white/70 hover:text-white sm:inline">Plans</a>
          <Link href="/login" className="rounded-lg px-3 py-2 text-white/70 hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-mint-400 px-3 py-2 font-medium text-ink-950">Start free</Link>
        </nav>
      </header>

      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="min-w-0">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-mint-400/30 bg-mint-400/10 px-3 py-1 text-xs font-medium text-mint-300"><Sparkles className="h-3.5 w-3.5" /> The ad on this page was made with Ghost Post</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Your whole AI studio in one app.</h1>
          <p className="mt-4 max-w-xl text-lg text-white/65">Pictures, videos, voices, music and sound effects, made by Ghost Post&apos;s own AI. Then it writes the captions and posts to TikTok, Instagram, YouTube and Facebook for you.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-xl bg-mint-400 px-6 py-3.5 text-base font-semibold text-ink-950 shadow-glow hover:bg-mint-300">Start free</Link>
            <a href="#plans" className="rounded-xl border border-white/15 px-6 py-3.5 text-base font-medium text-white hover:bg-white/5">See plans</a>
          </div>
          <p className="mt-3 text-sm text-white/45">No card needed. Free plan: 30 AI credits and 30 posts a month.</p>
        </div>
        <div className="mx-auto w-full max-w-[340px]">
          <AdPlayer src="/promo/ad-2026-web.mp4" webm="/promo/ad-2026-web.webm" poster="/promo/ad-2026.jpg" />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-semibold text-white">Made with Ghost Post</h2>
        <p className="mt-2 text-white/55">Every picture below came out of the app. No stock photos, no editing.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GALLERY.map((g) => (
            <figure key={g.src} className="group relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-ink-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.src} alt={g.line} loading="lazy" className="aspect-[9/16] w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-mint-300">{g.tool}</span>
                <span className="mt-0.5 block text-sm text-white">{g.line}</span>
              </figcaption>
            </figure>
          ))}
          <figure className="relative flex min-w-0 flex-col justify-center rounded-2xl border border-mint-400/30 bg-mint-400/10 p-5">
            <Wand2 className="h-6 w-6 text-mint-300" />
            <p className="mt-3 text-lg font-semibold text-white">Your idea next</p>
            <p className="mt-1 text-sm text-white/60">Make your first picture or video free in a few minutes.</p>
            <Link href="/signup" className="mt-4 inline-block rounded-lg bg-mint-400 px-4 py-2 text-center text-sm font-semibold text-ink-950">Start free</Link>
          </figure>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-semibold text-white">How it works</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="glass min-w-0 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-mint-400 font-semibold text-ink-950">{s.n}</span>
              <p className="mt-4 font-semibold text-white">{s.title}</p>
              <p className="mt-1 text-sm text-white/60">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-semibold text-white">Everything in one studio</h2>
        <p className="mt-2 text-white/55">One app, one login, one bill. Every tool works with the others, and everything you make lands in your library.</p>
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {STUDIO.map(({ icon: Icon, title, shot, text }) => (
            <article key={title} className="glass min-w-0 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt={`${title} in Ghost Post`} loading="lazy" className="aspect-[16/10] w-full border-b border-white/10 object-cover object-top" />
              <div className="p-5">
                <p className="flex items-center gap-2 font-semibold text-white"><Icon className="h-5 w-5 text-mint-300" /> {title}</p>
                <p className="mt-2 text-sm text-white/60">{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="plans" className="mt-20 scroll-mt-8">
        <h2 className="text-2xl font-semibold text-white">Plans</h2>
        <p className="mb-8 mt-2 text-white/55">Start free. Upgrade when it&apos;s paying for itself.</p>
        <PricingTable signedIn={false} initial={initial} />
        <p className="mt-6 text-xs text-white/40">Prices in USD. Paid plans renew automatically each month or year until cancelled; cancel any time from Plans &amp; Billing and keep your plan until the end of the period.</p>
      </section>

      <section className="mt-20 rounded-3xl border border-mint-400/25 bg-gradient-to-br from-mint-400/15 to-transparent p-8 text-center sm:p-12">
        <h2 className="text-3xl font-semibold text-white">Your studio is ready.</h2>
        <p className="mx-auto mt-3 max-w-lg text-white/65">Make your first picture, voice, song or video free, and let Ghost Post post it for you.</p>
        <Link href="/signup" className="mt-6 inline-block rounded-xl bg-mint-400 px-8 py-4 text-lg font-semibold text-ink-950 shadow-glow hover:bg-mint-300">Start free</Link>
      </section>

      <LegalFooter />
    </div>
  );
}
