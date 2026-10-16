/**
 * Content genres and the newsrooms each one listens to (shared by the server and the Trend Radar page).
 *
 * Sources are established newsrooms with editors and corrections policies: wire services, public broadcasters,
 * national outlets and, for Black America, the Black press (Capital B, TheGrio, The Root, Word In Black, Black
 * Enterprise, Essence, Andscape, NewsOne, AFRO, the NNPA's BlackPressUSA) alongside AP, NPR and PBS coverage.
 * Feed addresses change over time: the Trend Radar shows each feed's health, and the admin can add feeds.
 */
import type { Pillar, VideoPlan } from "./types";

export type FeedTier = "wire" | "public" | "national" | "specialist" | "black_press" | "reference";

export interface Feed {
  id: string;
  name: string;
  url: string;
  tier: FeedTier;
  /** "json-onthisday" = Wikipedia's On This Day API; everything else is RSS/Atom. */
  kind?: "rss" | "json-onthisday";
}

const gnews = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS: Record<string, Feed> = {
  // Wire services (no public RSS of their own; Google News search limited to their site)
  ap: { id: "ap", name: "AP News", url: gnews("site:apnews.com when:1d"), tier: "wire" },
  reuters: { id: "reuters", name: "Reuters", url: gnews("site:reuters.com when:1d"), tier: "wire" },
  google_top: { id: "google_top", name: "Google News top stories (US)", url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", tier: "national" },
  // Public broadcasters
  npr: { id: "npr", name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", tier: "public" },
  npr_business: { id: "npr_business", name: "NPR Business", url: "https://feeds.npr.org/1006/rss.xml", tier: "public" },
  npr_science: { id: "npr_science", name: "NPR Science", url: "https://feeds.npr.org/1007/rss.xml", tier: "public" },
  npr_politics: { id: "npr_politics", name: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml", tier: "public" },
  npr_health: { id: "npr_health", name: "NPR Health", url: "https://feeds.npr.org/1128/rss.xml", tier: "public" },
  pbs: { id: "pbs", name: "PBS NewsHour", url: "https://www.pbs.org/newshour/feeds/rss/headlines", tier: "public" },
  bbc_world: { id: "bbc_world", name: "BBC News World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", tier: "public" },
  bbc_us: { id: "bbc_us", name: "BBC News US & Canada", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", tier: "public" },
  // National outlets
  cbs: { id: "cbs", name: "CBS News", url: "https://www.cbsnews.com/latest/rss/main", tier: "national" },
  abc: { id: "abc", name: "ABC News", url: "https://feeds.abcnews.com/abcnews/topstories", tier: "national" },
  guardian_us: { id: "guardian_us", name: "The Guardian US", url: "https://www.theguardian.com/us-news/rss", tier: "national" },
  guardian_world: { id: "guardian_world", name: "The Guardian World", url: "https://www.theguardian.com/world/rss", tier: "national" },
  aljazeera: { id: "aljazeera", name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", tier: "national" },
  cnbc: { id: "cnbc", name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", tier: "national" },
  // Specialist outlets
  techcrunch: { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", tier: "specialist" },
  verge: { id: "verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", tier: "specialist" },
  ars: { id: "ars", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", tier: "specialist" },
  espn: { id: "espn", name: "ESPN", url: "https://www.espn.com/espn/rss/news", tier: "specialist" },
  variety: { id: "variety", name: "Variety", url: "https://variety.com/feed/", tier: "specialist" },
  billboard: { id: "billboard", name: "Billboard", url: "https://www.billboard.com/feed/", tier: "specialist" },
  sciencedaily: { id: "sciencedaily", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml", tier: "specialist" },
  nasa: { id: "nasa", name: "NASA", url: "https://www.nasa.gov/news-release/feed/", tier: "specialist" },
  upi_odd: { id: "upi_odd", name: "UPI Odd News", url: "https://rss.upi.com/news/odd_news.rss", tier: "wire" },
  ap_oddities: { id: "ap_oddities", name: "AP Oddities", url: gnews("site:apnews.com oddities when:7d"), tier: "wire" },
  polygon: { id: "polygon", name: "Polygon", url: "https://www.polygon.com/rss/index.xml", tier: "specialist" },
  eater: { id: "eater", name: "Eater", url: "https://www.eater.com/rss/index.xml", tier: "specialist" },
  courts: { id: "courts", name: "AP & NPR courts coverage", url: gnews("(verdict OR sentenced OR trial OR charged) (site:apnews.com OR site:npr.org) when:2d"), tier: "wire" },
  // The Black press and Black America coverage
  capitalb: { id: "capitalb", name: "Capital B News", url: "https://capitalbnews.org/feed/", tier: "black_press" },
  thegrio: { id: "thegrio", name: "TheGrio", url: "https://thegrio.com/feed/", tier: "black_press" },
  theroot: { id: "theroot", name: "The Root", url: "https://www.theroot.com/rss", tier: "black_press" },
  wordinblack: { id: "wordinblack", name: "Word In Black", url: "https://wordinblack.com/feed/", tier: "black_press" },
  blackenterprise: { id: "blackenterprise", name: "Black Enterprise", url: "https://www.blackenterprise.com/feed/", tier: "black_press" },
  essence: { id: "essence", name: "Essence", url: "https://www.essence.com/feed/", tier: "black_press" },
  andscape: { id: "andscape", name: "Andscape", url: "https://andscape.com/feed/", tier: "black_press" },
  newsone: { id: "newsone", name: "NewsOne", url: "https://newsone.com/feed/", tier: "black_press" },
  afro: { id: "afro", name: "AFRO News", url: "https://afro.com/feed/", tier: "black_press" },
  blackpressusa: { id: "blackpressusa", name: "BlackPressUSA (NNPA)", url: "https://blackpressusa.com/feed/", tier: "black_press" },
  black_wires: {
    id: "black_wires",
    name: "AP, NPR & PBS on Black America",
    url: gnews('("Black Americans" OR "African American" OR HBCU OR "Black-owned") (site:apnews.com OR site:npr.org OR site:pbs.org OR site:nbcnews.com) when:3d'),
    tier: "wire",
  },
  // Reference
  onthisday: { id: "onthisday", name: "Wikipedia: On this day", url: "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events", tier: "reference", kind: "json-onthisday" },
};

export interface Genre {
  id: string;
  name: string;
  /** What the genre covers, given to the writer. */
  brief: string;
  /** Feeds to watch. Empty = evergreen genre: documented stories, tied to today's news or date when there's a real link. */
  feeds: string[];
  /** Revenue table row (src/lib/niches.ts) used for RPM and video defaults. */
  niche: string;
  style: VideoPlan["style"];
  /** Internal pillar used for scoring and the money mix. */
  pillar: Pillar;
  /** Extra rules for this genre. */
  rules?: string;
}

export const BLACK_AMERICA_RULES = `BLACK AMERICA COVERAGE RULES
- Ground every piece in reporting from the Black press (Capital B, TheGrio, The Root, Word In Black, Black Enterprise, Essence, Andscape, NewsOne, AFRO, BlackPressUSA) or wire and public-media coverage (AP, NPR, PBS). Name the outlet in the caption.
- Cover the full life of Black America: business and wealth-building, HBCUs and education, culture, music and sports, health, faith, politics and policy that affects Black communities, history and its present-day echoes, achievements and firsts.
- Accuracy and dignity first: no stereotypes, no trauma-for-clicks, no graphic violence, no mugshot-style framing. People accused of crimes are "accused" or "charged" until convicted. Victims and families are treated with respect.
- No unverified viral claims, rumors or screenshots. If a story is still developing, say so.
- When data is used (e.g. census, wealth gap, health outcomes), name its source and year. Never invent a statistic.
- Nonpartisan: explain what happened and how it affects people; don't campaign for a party or candidate.`;

export const GENRES: Genre[] = [
  { id: "trending", name: "Trending now", brief: "The biggest US and world stories right now, explained fast: what happened, why it matters to the viewer, what happens next.", feeds: ["ap", "reuters", "npr", "pbs", "cbs", "abc", "bbc_us", "guardian_us", "google_top"], niche: "news", style: "explainer", pillar: "high_agency" },
  { id: "black_america", name: "Black America", brief: "News, culture, business, history and achievements from Black America, told with accuracy and pride.", feeds: ["capitalb", "thegrio", "theroot", "wordinblack", "blackenterprise", "essence", "andscape", "newsone", "afro", "blackpressusa", "black_wires"], niche: "news", style: "true", pillar: "high_agency", rules: BLACK_AMERICA_RULES },
  { id: "world", name: "World news", brief: "Major world events explained for a US audience: who, what, where and why it matters.", feeds: ["reuters", "bbc_world", "aljazeera", "guardian_world", "ap"], niche: "news", style: "explainer", pillar: "high_agency" },
  { id: "money", name: "Money & business", brief: "Markets, companies, jobs, prices and personal-finance news, with what it means for the viewer's wallet. Educational, never personal advice or buy/sell calls.", feeds: ["cnbc", "npr_business", "blackenterprise", "ap"], niche: "finance", style: "explainer", pillar: "wealth_systems" },
  { id: "tech_ai", name: "Tech & AI", brief: "AI, gadgets, apps, big tech and cybersecurity news: what changed and how to use it or protect yourself.", feeds: ["techcrunch", "verge", "ars"], niche: "tech", style: "explainer", pillar: "ai_leverage" },
  { id: "politics", name: "Politics explained", brief: "Strictly nonpartisan explainers: what a law, ruling, election result or policy does, who it affects, and what happens next.", feeds: ["npr_politics", "pbs", "ap"], niche: "news", style: "explainer", pillar: "high_agency", rules: "Nonpartisan only: no endorsing or attacking parties or candidates, no loaded labels, quote both sides' stated positions when relevant, attribute every claim." },
  { id: "true_crime", name: "True crime & justice", brief: "Court cases, verdicts and investigations from reliable reporting, plus classic documented cases.", feeds: ["courts"], niche: "ent", style: "true", pillar: "high_agency", rules: "Presumption of innocence: 'accused', 'charged', 'alleged' until a verdict. No graphic violence or gore, never glamorize offenders, respect victims and families, no speculation about unsolved details." },
  { id: "entertainment", name: "Celebrity & entertainment", brief: "Film, TV, music and celebrity news that's confirmed by the outlet, plus box office and awards.", feeds: ["variety", "billboard", "essence"], niche: "ent", style: "countdown", pillar: "high_agency", rules: "Confirmed reports only: no rumors, no speculation about anyone's health, relationships or private life, no body commentary." },
  { id: "sports", name: "Sports", brief: "Big games, records, trades, comebacks and the stories behind the athletes.", feeds: ["espn", "andscape"], niche: "health", style: "true", pillar: "high_agency" },
  { id: "science_space", name: "Science & space", brief: "New discoveries, space missions and research findings, explained without hype.", feeds: ["sciencedaily", "nasa", "npr_science"], niche: "edu", style: "explainer", pillar: "high_agency", rules: "Say what the study or mission actually found, its size or stage, and who published it. Early or animal studies are labeled as such." },
  { id: "health", name: "Health & wellness", brief: "Health news and well-established habits, framed as practical takeaways.", feeds: ["npr_health"], niche: "health", style: "explainer", pillar: "longevity", rules: "No medical advice, cures, dosages or diagnoses. Point people to a professional for anything personal." },
  { id: "history", name: "History & on this day", brief: "Documented events that happened on today's date, and history behind today's headlines.", feeds: ["onthisday"], niche: "edu", style: "true", pillar: "high_agency" },
  { id: "weird", name: "Weird but true", brief: "Real, verified odd news and absurd-but-true events, told deadpan.", feeds: ["upi_odd", "ap_oddities"], niche: "ent", style: "funny", pillar: "high_agency", rules: "The facts are the joke. Never mock victims, never invent details." },
  { id: "motivation", name: "Comebacks & success", brief: "Documented comeback, underdog and success stories, including ones in today's news.", feeds: ["blackenterprise", "espn"], niche: "finance", style: "true", pillar: "high_agency" },
  { id: "relationships", name: "Relationships & psychology", brief: "Attraction, communication and human-behavior research with practical takeaways.", feeds: [], niche: "lifestyle", style: "explainer", pillar: "relationships" },
  { id: "mystery", name: "Mysteries & unexplained", brief: "Documented mysteries, disappearances, unsolved puzzles and strange history, with what is actually known.", feeds: [], niche: "edu", style: "true", pillar: "high_agency", rules: "Separate what's documented from theories; never present a theory as fact." },
  { id: "gaming", name: "Gaming", brief: "Game releases, industry news, esports and game history.", feeds: ["polygon", "verge"], niche: "gaming", style: "countdown", pillar: "ai_leverage" },
  { id: "food", name: "Food", brief: "Food news, restaurant and food-business stories, food history.", feeds: ["eater"], niche: "food", style: "true", pillar: "longevity" },
  { id: "story_time", name: "Story time (fiction)", brief: "Original short stories with cliffhangers, always labeled as fiction.", feeds: [], niche: "ent", style: "fiction", pillar: "relationships", rules: "Always labeled \"Fiction\" in the caption. Never about real private people." },
];

export const genreById = (id: string | undefined) => GENRES.find((g) => g.id === id);
export const TIER_LABEL: Record<FeedTier, string> = {
  wire: "Wire service",
  public: "Public media",
  national: "National outlet",
  specialist: "Specialist outlet",
  black_press: "Black press",
  reference: "Reference",
};
