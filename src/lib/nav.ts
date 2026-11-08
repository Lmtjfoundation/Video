import { Activity, AudioLines, BookOpen, BookOpenText, CalendarDays, Clapperboard, Code2, Compass, CreditCard, Feather, Film, Flame, FolderOpen, Images, LayoutDashboard, Library, Lightbulb, ListVideo, MessageSquare, MessagesSquare, Mic, Palette, Rocket, ScrollText, Settings, Share2, ShieldCheck, Sparkles, UserRound, Video, Wand2, Workflow } from "lucide-react";

export type Tool = { href: string; label: string; blurb: string; icon: typeof Activity; badge?: "pending" | "review" };
export type Section = { key: string; href: string; label: string; short: string; blurb: string; icon: typeof Activity; tools: Tool[]; admin?: boolean };

/**
 * The whole app in five places. Every page still exists; the sidebar shows the five sections and, inside the one you
 * are in, its tools. Each section also has a hub page with a card per tool, so nothing is ever more than two taps away.
 */
export const SECTIONS: Section[] = [
  { key: "home", href: "/", label: "Home", short: "Home", icon: LayoutDashboard, blurb: "Your agent's status, money pipeline and latest activity.", tools: [] },
  {
    key: "make", href: "/make", label: "Make", short: "Make", icon: Sparkles,
    blurb: "Write, film, voice and edit: posts, stories, series and movies.",
    tools: [
      { href: "/studio", label: "Content Studio", icon: Sparkles, blurb: "Posts, captions and short videos for every platform in one go." },
      { href: "/stories", label: "Story Studio", icon: BookOpenText, blurb: "Turn an idea into a story, then into posts or videos." },
      { href: "/writers", label: "Writers' Room", icon: Feather, blurb: "Plan a series: bible, characters and episode scripts." },
      { href: "/series", label: "Series Studio", icon: ListVideo, blurb: "Keep characters consistent across every episode." },
      { href: "/movie-maker", label: "Movie Maker", icon: Clapperboard, blurb: "Script to finished motion-graphics episode, with voices and music." },
      { href: "/movies", label: "Movie Studio", icon: Film, blurb: "Longer films, scene by scene." },
      { href: "/film-engine", label: "Film Engine", icon: Clapperboard, blurb: "Camera moves, depth and effects on your pictures." },
      { href: "/director", label: "Director", icon: MessagesSquare, blurb: "Talk through a shot list and let the AI direct it." },
      { href: "/story-video", label: "Story to Video", icon: BookOpen, blurb: "Paste a story, get a narrated video." },
      { href: "/create", label: "AI Studio", icon: Wand2, blurb: "Music, sound effects, footage and voiceovers from a prompt." },
      { href: "/images", label: "Image Studio", icon: Palette, blurb: "Make, edit, upscale and cut out pictures." },
      { href: "/video-tools", label: "Video Tools", icon: Video, blurb: "Trim, caption, resize, color-grade and dub videos." },
      { href: "/voice-lab", label: "Voice Lab", icon: AudioLines, blurb: "Text to speech, voice design, cloning and clean-up." },
      { href: "/voice-lab?tab=record", label: "Record Voice", icon: Mic, blurb: "Record your own voice for a clone or a voiceover." },
      { href: "/explain", label: "Explain", icon: Lightbulb, blurb: "Paste anything and get it in plain English, or as a video." },
      { href: "/flows", label: "Flows", icon: Workflow, blurb: "Chain tools together and run them in one click." },
    ],
  },
  {
    key: "grow", href: "/grow", label: "Grow", short: "Grow", icon: Rocket,
    blurb: "Find what's trending, schedule it, post it and answer your audience.",
    tools: [
      { href: "/trends", label: "Trend Radar", icon: Flame, blurb: "What's rising right now in your niche." },
      { href: "/niche", label: "Niche Lab", icon: Compass, blurb: "Find a niche and the angle that earns." },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, blurb: "Schedule posts, or let the agent fill your week." },
      { href: "/platforms", label: "Platforms", icon: Share2, blurb: "Link your social accounts." },
      { href: "/engage", label: "Engagement", icon: MessageSquare, blurb: "Comments and messages, with suggested replies.", badge: "pending" },
    ],
  },
  {
    key: "files", href: "/files", label: "Library", short: "Library", icon: FolderOpen,
    blurb: "Everything you've made or uploaded, plus music, sound and footage to use.",
    tools: [
      { href: "/media", label: "My Media", icon: Images, blurb: "Your pictures, videos and audio." },
      { href: "/library", label: "Asset Library", icon: Library, blurb: "Music, sound effects, footage and templates, with licenses." },
    ],
  },
  {
    key: "account", href: "/account", label: "Account", short: "Account", icon: UserRound,
    blurb: "Your plan, settings and history.",
    tools: [
      { href: "/plans", label: "Plans & Billing", icon: CreditCard, blurb: "Your plan, credits and invoices." },
      { href: "/settings", label: "Settings", icon: Settings, blurb: "Autopilot, brand voice and your own AI keys." },
      { href: "/logs", label: "Activity Log", icon: ScrollText, blurb: "Everything the agent did, and when." },
      { href: "/developers", label: "Developers", icon: Code2, blurb: "API keys and docs." },
    ],
  },
  {
    key: "admin", href: "/admin", label: "Admin", short: "Admin", icon: ShieldCheck, admin: true,
    blurb: "Owner tools: users, review queue and app settings.", tools: [],
  },
];

/** Which section a path belongs to (a section's hub, or any of its tools). */
export function sectionFor(path: string, search = ""): Section {
  const full = path + search;
  for (const s of SECTIONS) {
    if (s.href !== "/" && (path === s.href || path.startsWith(s.href + "/"))) return s;
    if (s.tools.some((t) => matches(t.href, path, full))) return s;
  }
  return SECTIONS[0];
}

export function matches(href: string, path: string, full = path): boolean {
  if (href.includes("?")) return full === href;
  return path === href || path.startsWith(href + "/");
}
