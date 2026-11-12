import { Activity, AudioLines, BookOpenText, CalendarDays, Clapperboard, Code2, Compass, CreditCard, Feather, Film, Flame, FolderOpen, Images, LayoutDashboard, Library, Lightbulb, ListVideo, MessageSquare, MessagesSquare, Mic, Music2, Palette, Rocket, ScrollText, Settings, Share2, ShieldCheck, Sparkles, UserRound, Video, Wand2, Workflow } from "lucide-react";

export type Tool = { href: string; label: string; blurb: string; icon: typeof Activity; badge?: "pending" | "review"; group?: string };
export type Section = { key: string; href: string; label: string; short: string; blurb: string; icon: typeof Activity; tools: Tool[]; admin?: boolean };

/**
 * The whole app in five places. Every page still exists; the sidebar shows the five sections and, inside the one you
 * are in, its tools. Each section also has a hub page with a card per tool, so nothing is ever more than two taps away.
 */
export const SECTIONS: Section[] = [
  { key: "home", href: "/", label: "Home", short: "Home", icon: LayoutDashboard, blurb: "Your agent's status, money pipeline and latest activity.", tools: [] },
  {
    key: "make", href: "/make", label: "Make", short: "Make", icon: Sparkles,
    blurb: "Pick what you want to make. Start here has the most-used; everything else is below.",
    tools: [
      // Start here: the five things most people come to make, each one tap away.
      { group: "Start here", href: "/story-video", label: "Pitch to Movie", icon: Clapperboard, blurb: "Type a one-line pitch. Get a narrated, finished movie with pictures, voice and music." },
      { group: "Start here", href: "/video-tools?tab=music", label: "Music Video", icon: Music2, blurb: "Add your song, describe the look. Get a video cut to the beat." },
      { group: "Start here", href: "/voice-lab?tab=v2v", label: "Voice & Lip Sync", icon: Mic, blurb: "Put any voice on any video, and make the mouth match the words." },
      { group: "Start here", href: "/voice-lab?tab=presenter", label: "Talking Presenter", icon: UserRound, blurb: "A lifelike presenter says your script, lips matching every word." },
      { group: "Start here", href: "/images", label: "Pictures", icon: Palette, blurb: "Make, edit and upscale pictures, keeping your characters' faces." },
      { group: "Start here", href: "/studio", label: "Posts & Captions", icon: Sparkles, blurb: "Posts, captions and short videos for every platform in one go." },
      // Movies & series: bigger projects, step by step.
      { group: "Movies & series", href: "/writers", label: "Writers' Room", icon: Feather, blurb: "Plan a series: story bible, characters and episode scripts." },
      { group: "Movies & series", href: "/series", label: "Series Studio", icon: ListVideo, blurb: "Keep characters looking the same in every episode." },
      { group: "Movies & series", href: "/movie-maker", label: "Movie Maker", icon: Clapperboard, blurb: "Script to finished episode, with voices, music and motion." },
      { group: "Movies & series", href: "/movies", label: "Movie Studio", icon: Film, blurb: "Longer films, scene by scene." },
      { group: "Movies & series", href: "/director", label: "Director", icon: MessagesSquare, blurb: "Talk through a shot list and let the AI direct it." },
      { group: "Movies & series", href: "/film-engine", label: "Film Engine", icon: Clapperboard, blurb: "Camera moves, depth and effects on your pictures." },
      { group: "Movies & series", href: "/stories", label: "Story Studio", icon: BookOpenText, blurb: "Turn an idea into a story, then into posts or videos." },
      // Sound & video tools.
      { group: "Sound & video tools", href: "/video-tools", label: "Video Tools", icon: Video, blurb: "Trim, caption, resize, restyle and relight videos." },
      { group: "Sound & video tools", href: "/voice-lab", label: "Voice Lab", icon: AudioLines, blurb: "Text to speech, voice design, cloning, clean-up and captions." },
      { group: "Sound & video tools", href: "/voice-lab?tab=record", label: "Record Voice", icon: Mic, blurb: "Record your own voice for a clone or a voiceover." },
      { group: "Sound & video tools", href: "/create", label: "Music & Sound", icon: Wand2, blurb: "Music, sound effects and footage from a description." },
      { group: "Sound & video tools", href: "/explain", label: "Explain", icon: Lightbulb, blurb: "Paste anything and get it in plain English, or as a video." },
      { group: "Sound & video tools", href: "/flows", label: "Flows", icon: Workflow, blurb: "Chain tools together and run them in one click." },
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

/** The tool a page belongs to inside its section: an exact link with its ?tab= wins over the plain page. */
export function activeTool(tools: Tool[], path: string, full = path): Tool | undefined {
  return tools.find((t) => t.href.includes("?") && full === t.href) ?? tools.find((t) => !t.href.includes("?") && matches(t.href, path, full));
}

/** A section's tools in their groups, in order (tools without a group come first, unlabelled). */
export function grouped(tools: Tool[]): { group: string; tools: Tool[] }[] {
  const out: { group: string; tools: Tool[] }[] = [];
  for (const t of tools) {
    const g = t.group ?? "";
    const last = out[out.length - 1];
    if (last && last.group === g) last.tools.push(t);
    else out.push({ group: g, tools: [t] });
  }
  return out;
}
