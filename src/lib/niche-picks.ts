import { NICHES } from "./niches";
import type { NicheReport } from "./types";

/* Built-in niche picks: shown on plans without Claude-powered niche research, and as a fallback.
   Ranked by measured median RPM (AIR Media-Tech). Every story idea is a real, documented event;
   "funny" means the history itself was absurd — no invented jokes. */
type Niche = NicheReport["niches"][number];
type Pick = Omit<Niche, "dataNiche" | "rpmBasis"> & { dataId: string };

export const BUILTIN_PICKS: Pick[] = [
  { dataId: "edu", name: "History's strangest true stories (funny history)", competition: "medium",
    whyItEarns: "Education & Science has the highest measured median RPM in the table, and absurd-but-true history gets shared and rewatched, which grows views without clickbait.",
    facelessFormat: "Narration over archival photos, maps and AI-illustrated scenes; a dry, deadpan voice lets the real events be the joke.",
    audience: "Adults 18–45 who like history, trivia and documentaries; strong in the US, UK, Canada and Australia.",
    storyIdeas: [
      { title: "Australia declared war on emus (1932) — and the emus won", hook: "In 1932, Australia sent soldiers with machine guns to fight birds. The birds won.", type: "funny" },
      { title: "The pope who put a corpse on trial (the Cadaver Synod, 897)", hook: "A pope dug up the last pope, dressed him in robes, sat him on a throne — and put him on trial.", type: "funny" },
      { title: "The warship that sank on its first trip out of the harbor (Vasa, 1628)", hook: "Sweden's mightiest warship sailed about 1,300 meters in front of a cheering crowd. Then it sank.", type: "funny" },
      { title: "The summer a city couldn't stop dancing (Strasbourg, 1518)", hook: "In July 1518, one woman started dancing in the street. Within weeks, dozens more joined her — and couldn't stop.", type: "true" },
      { title: "The day a wave of beer flooded London (1814)", hook: "In 1814, a giant vat burst and a wave of beer swept through a London neighborhood.", type: "true" },
      { title: "The dirty dish that saved millions (penicillin, 1928)", hook: "A scientist came back from vacation, found mold on a dish he forgot to clean — and changed medicine forever.", type: "true" },
    ],
    monetization: ["Book and history-gift affiliate links (e.g. Amazon Associates)", "Sponsors: learning apps, audiobook and documentary streaming services", "Membership/Patreon for bonus deep-dives", "Long-form compilations for mid-roll ads"],
    risks: ["Accuracy: check dates, numbers and names against reliable sources — viewers correct mistakes loudly", "Avoid mocking real victims; the absurdity is the system or situation, not the people who died", "Mass-produced, repetitive videos can lose monetization under YouTube's policies — vary formats and add real research"],
    first30Days: ["Publish 3 Shorts a week from the ideas above and turn the best one into an 8–10 minute video", "Build a recurring series name (e.g. \"History's Dumbest Days\") so viewers binge", "Test titles: the absurd fact in the first 5 words"] },
  { dataId: "transport", name: "Aviation & engineering disasters explained", competition: "medium",
    whyItEarns: "Transport has the second-highest measured median RPM; investigation-style stories hold attention for long videos, which earn mid-roll ads.",
    facelessFormat: "Animated diagrams, maps and cockpit-style recreations with calm, precise narration.",
    audience: "Adults 25–55 interested in aviation, engineering and how things fail.",
    storyIdeas: [
      { title: "The jet that ran out of fuel at 41,000 feet because of a units mix-up (Gimli Glider, 1983)", hook: "A brand-new Boeing 767 ran out of fuel mid-flight — because someone used pounds instead of kilograms.", type: "true" },
      { title: "The pilot who was sucked halfway out the window — and survived (British Airways 5390, 1990)", hook: "At 17,000 feet the windshield blew out, and the captain went with it.", type: "true" },
      { title: "How NASA fit a square filter into a round hole to save Apollo 13 (1970)", hook: "Three astronauts were running out of breathable air. The fix was made from duct tape, plastic bags and a manual cover.", type: "explainer" },
      { title: "The $125 million spacecraft lost to a units mix-up (Mars Climate Orbiter, 1999)", hook: "One team used metric. The other didn't. The spacecraft never made it to orbit.", type: "true" },
      { title: "The bridge that tore itself apart in the wind (Tacoma Narrows, 1940)", hook: "Locals called it Galloping Gertie. Four months after it opened, the wind ripped it apart on camera.", type: "explainer" },
      { title: "Why the Titanic's lookouts had no binoculars (1912)", hook: "The key to the binocular locker left the ship with an officer who was removed from the crew days before.", type: "true" },
    ],
    monetization: ["Flight-sim, model-kit and aviation-book affiliates", "Sponsors: VPNs, learning platforms, travel apps", "Long-form investigations (8–15 min) for mid-roll ads"],
    risks: ["Recent crashes involve grieving families — focus on historic, fully investigated cases and official reports", "Technical errors get called out; cite the official investigation report for each story"],
    first30Days: ["Pick 6 fully investigated historic cases and read each official report", "Make a 60-second teaser Short for each long video", "Use a consistent thumbnail style: aircraft + one bold word"] },
  { dataId: "tech", name: "Tech history: billion-dollar mistakes", competition: "medium",
    whyItEarns: "Gadgets & Tech carries a solid measured RPM and attracts software and gadget advertisers; famous tech blunders are surprising, true and highly shareable.",
    facelessFormat: "Screen recordings, archival product shots and simple motion graphics.",
    audience: "Adults 18–45 who work in or follow tech.",
    storyIdeas: [
      { title: "The first computer bug was an actual bug (1947)", hook: "In 1947, engineers found a moth stuck in their computer — and taped it into the logbook.", type: "funny" },
      { title: "The rocket that exploded because a number got too big (Ariane 5, 1996)", hook: "Thirty-seven seconds after launch, a rocket worth hundreds of millions destroyed itself — over one line of code.", type: "true" },
      { title: "The spreadsheet that lost nearly 16,000 COVID cases (England, 2020)", hook: "A national pandemic dashboard went wrong because a file ran out of rows.", type: "true" },
      { title: "Kodak invented the digital camera in 1975 — then shelved it", hook: "The company that killed film was the one that sold it.", type: "true" },
      { title: "Nintendo started in 1889 making playing cards", hook: "Before Mario, Nintendo sold hand-painted playing cards in Kyoto.", type: "true" },
      { title: "Y2K: the disaster that didn't happen — and why", hook: "The world spent billions on a bug. Was it all for nothing?", type: "explainer" },
    ],
    monetization: ["Software and gadget affiliate programs", "Sponsors: developer tools, password managers, VPNs", "Newsletter for tech-history fans"],
    risks: ["Check numbers (costs, dates) against original reports", "Avoid speculation about why companies made choices unless it's documented"],
    first30Days: ["Start with the most absurd stories (the moth, Ariane 5)", "Pin a comment asking for the next mistake to cover", "Pair each Short with a carousel or thread for X and LinkedIn"] },
  { dataId: "finance", name: "Company rise-and-fall stories", competition: "high",
    whyItEarns: "Business & Finance has a directional median RPM of $2.01 in the table (only 3 channels measured), and other published sources rank finance advertiser prices among the highest of any niche.",
    facelessFormat: "Stock footage, headline screenshots and timeline graphics with a documentary narrator.",
    audience: "Adults 22–50 interested in business, investing and startups.",
    storyIdeas: [
      { title: "Blockbuster turned down buying Netflix for $50 million (2000)", hook: "In 2000, Netflix offered itself to Blockbuster for $50 million. Blockbuster said no.", type: "true" },
      { title: "The man who sold his 10% of Apple for $800 (1976)", hook: "Apple's third co-founder walked away after 12 days with $800.", type: "true" },
      { title: "Two pizzas for 10,000 Bitcoin (May 22, 2010)", hook: "The most expensive pizza order in history cost 10,000 Bitcoin.", type: "funny" },
      { title: "New Coke: the 79-day disaster (1985)", hook: "Coca-Cola changed its recipe and America revolted. Seventy-nine days later, the old Coke was back.", type: "true" },
      { title: "Enron was named 'most innovative' six years in a row — then collapsed (2001)", hook: "Fortune called Enron America's most innovative company for six straight years. Then it went bankrupt.", type: "true" },
      { title: "The McDonald brothers sold their name — and the empire went with it (1961)", hook: "The brothers who invented fast food sold out for $2.7 million.", type: "true" },
    ],
    monetization: ["Investing-app and brokerage affiliates (follow FTC and platform finance rules)", "Sponsors: business tools, newsletters, courses", "Digital products: business-lesson guides"],
    risks: ["No investment advice or income claims — tell the story, not stock picks", "High competition: win with sharper research and better hooks, not volume"],
    first30Days: ["Use the 'one decision that changed everything' angle in every title", "Publish 2 long-form stories and 6 Shorts", "Add a disclosure line on any finance affiliate link"] },
];

export function builtInNiches(interests: string): { summary: string; niches: Niche[] } {
  const words = interests.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const score = (p: Pick) => {
    const hay = `${p.name} ${p.audience ?? ""} ${(p.storyIdeas ?? []).map((s) => s.title).join(" ")} ${NICHES.find((n) => n.id === p.dataId)?.formats ?? ""}`.toLowerCase();
    return words.filter((w) => hay.includes(w)).length;
  };
  const rpm = (p: Pick) => NICHES.find((n) => n.id === p.dataId)?.rpm ?? 0;
  const ranked = [...BUILTIN_PICKS].sort((a, b) => score(b) - score(a) || rpm(b) - rpm(a));
  const niches: Niche[] = ranked.map(({ dataId, ...p }) => {
    const n = NICHES.find((x) => x.id === dataId)!;
    return { ...structuredClone(p), dataNiche: n.name, rpmBasis: `Median RPM $${n.rpm.toFixed(2)} (middle half $${n.lo.toFixed(2)}–$${n.hi.toFixed(2)})${n.dir ? ", directional sample" : ""}` };
  });
  const matched = words.length > 0 && ranked.some((p) => score(p) > 0);
  const summary = words.length && !matched
    ? "None of the built-in picks match your interests closely, so these are the highest-earning niches overall. Claude-powered research tailors picks to your interests on paid plans."
    : words.length
      ? "Built-in picks, sorted by how well they match your interests, then by measured RPM."
      : "The highest-earning niches for faceless story content, ranked by measured median RPM. Every story idea is a real, documented event.";
  return { summary, niches };
}
