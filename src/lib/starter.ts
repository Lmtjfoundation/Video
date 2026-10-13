import "server-only";
import { finalizePost } from "./generate";
import { listPosts, savePosts } from "./repo";
import { videoPost } from "./video";
import { EXAMPLE_VIDEO } from "./video-spec";
import { PLATFORM_SPECS } from "./platforms/specs";
import { nowIso, uid } from "./utils";
import type { Pillar, Platform, Post, Settings } from "./types";

/**
 * Ready-made starter content: written by hand, every fact documented, no AI credits needed.
 * Lets a new account see real, publishable posts and render real videos before Claude is connected.
 */
interface Story {
  niche: "edu" | "transport" | "tech" | "finance";
  hook: string;
  body: string;
  tags: string[];
}

const CTA = "Follow for more true stories that sound made up.";
const PILLAR: Record<Story["niche"], Pillar> = { edu: "high_agency", transport: "high_agency", tech: "ai_leverage", finance: "wealth_systems" };

export const STARTER_STORIES: Story[] = [
  {
    niche: "edu",
    hook: "In 1932, Australia sent soldiers with machine guns to fight emus. The emus won.",
    body: "About 20,000 emus were eating the wheat of farmers in Western Australia. In November 1932 the army sent Major G.P.W. Meredith, two soldiers and two Lewis guns. The birds split into small groups, a gun jammed during an ambush, and by December the soldiers had been pulled out. Reports of how many emus died still disagree.",
    tags: ["history", "funnyhistory", "emuwar"],
  },
  {
    niche: "edu",
    hook: "In 897, a pope put his dead predecessor on trial.",
    body: "Pope Stephen VI had the body of Pope Formosus dug up, dressed in papal robes and propped on a throne to face charges. A deacon answered for the corpse. Formosus was found guilty, his acts were cancelled and his body was thrown into the Tiber. The trial caused such outrage that Stephen was overthrown and killed in prison later that year.",
    tags: ["history", "medievalhistory", "truestory"],
  },
  {
    niche: "edu",
    hook: "Sweden's mightiest warship sailed about 1,300 meters. Then it sank.",
    body: "On 10 August 1628 the Vasa left Stockholm on its maiden voyage while crowds watched. It was top-heavy, with too little ballast for its two decks of guns. A gust of wind tipped it, water poured through the open gunports, and it went down in the harbor. It was raised in 1961 and you can visit it today at the Vasa Museum.",
    tags: ["history", "shipwreck", "sweden"],
  },
  {
    niche: "edu",
    hook: "In 1518, a woman started dancing in a street in Strasbourg — and dozens of people couldn't stop.",
    body: "It began in July with a woman recorded as Frau Troffea. Within weeks many more people were dancing for days. City officials decided the cure was more dancing, so they set aside halls and hired musicians. Historians still debate the cause; one leading theory is mass stress after years of famine and disease.",
    tags: ["history", "strangehistory", "dancingplague"],
  },
  {
    niche: "edu",
    hook: "In 1814, a wave of beer flooded a London neighborhood.",
    body: "On 17 October 1814 a huge vat burst at the Meux brewery near Tottenham Court Road. Hundreds of thousands of gallons of beer knocked down walls and swept into the crowded homes of St Giles. Eight people died. The inquest ruled the deaths an accident, and no one was held responsible.",
    tags: ["history", "london", "truestory"],
  },
  {
    niche: "edu",
    hook: "A dirty dish left out during a vacation changed medicine forever.",
    body: "In September 1928 Alexander Fleming came back from holiday and noticed mold growing on one of his bacteria plates. Around the mold, the bacteria had died. He named the substance penicillin. It took Howard Florey and Ernst Chain's team in the 1940s to turn it into a mass-produced drug, and the three shared the 1945 Nobel Prize.",
    tags: ["history", "science", "penicillin"],
  },
  {
    niche: "transport",
    hook: "In 1983, a brand-new jet ran out of fuel at 41,000 feet — because of a units mix-up.",
    body: "Air Canada Flight 143's fuel gauges weren't working, so the fuel was worked out by hand. The new Boeing 767 used kilograms, but the math used pounds, so it left with less than half the fuel it needed. Captain Bob Pearson, an experienced glider pilot, glided it to an old air base at Gimli, Manitoba. No one on board was killed. It became known as the Gimli Glider.",
    tags: ["aviation", "history", "gimliglider"],
  },
  {
    niche: "transport",
    hook: "In 1990, a pilot was sucked halfway out of his cockpit window — and survived.",
    body: "Minutes after British Airways Flight 5390 left Birmingham, a cockpit windscreen blew out. It had been fitted with bolts that were slightly too small. Captain Tim Lancaster was pulled partly outside while the cabin crew held on to him. The co-pilot landed safely at Southampton, and the captain survived.",
    tags: ["aviation", "truestory", "history"],
  },
  {
    niche: "transport",
    hook: "Apollo 13's crew was saved by duct tape, a plastic bag and a cardboard cover.",
    body: "After an oxygen tank exploded in April 1970, the astronauts moved into the lunar module. Carbon dioxide started building up, but the command module's square filters didn't fit the lunar module's round sockets. Engineers on the ground built an adapter from items on board — plastic bags, cardboard, hose and duct tape — and talked the crew through it. All three made it home.",
    tags: ["space", "nasa", "history"],
  },
  {
    niche: "transport",
    hook: "NASA lost a Mars spacecraft because one team used pounds and the other used newtons.",
    body: "In September 1999 the Mars Climate Orbiter came in far too close to Mars and was lost. Software from the contractor reported thruster impulse in pound-force seconds, while NASA's navigation team expected newton-seconds. Small errors added up over the months-long trip. The investigation board's main finding was that one missing conversion.",
    tags: ["space", "nasa", "engineering"],
  },
  {
    niche: "transport",
    hook: "A bridge in Washington State twisted itself apart in the wind, four months after it opened.",
    body: "The Tacoma Narrows Bridge opened in July 1940 and quickly earned the nickname Galloping Gertie because its deck moved in the wind. On 7 November 1940, in winds of about 40 mph, it began twisting violently and collapsed. No people died. Engineers studied the film for decades, and bridge design changed because of it.",
    tags: ["engineering", "history", "tacomanarrows"],
  },
  {
    niche: "transport",
    hook: "The Titanic's lookouts had no binoculars.",
    body: "An officer named David Blair was moved off the crew just before the voyage, and the key to the locker believed to hold the crow's nest binoculars is said to have gone with him. Lookout Fred Fleet later told an inquiry that binoculars might have given them more time. That key was sold at auction in 2007.",
    tags: ["titanic", "history", "truestory"],
  },
  {
    niche: "tech",
    hook: "The first computer bug was an actual bug.",
    body: "On 9 September 1947, operators of the Harvard Mark II computer found a moth stuck in a relay. They taped it into the logbook with the note 'First actual case of bug being found.' Engineers had already called glitches 'bugs' for decades, but this moth made the story famous, and the logbook page is now at the Smithsonian.",
    tags: ["techhistory", "computers", "programming"],
  },
  {
    niche: "tech",
    hook: "A rocket blew up 40 seconds after launch because one number got too big.",
    body: "On 4 June 1996, the first Ariane 5 veered off course and self-destructed. Its guidance software was reused from the older Ariane 4. Ariane 5 flew faster, so a speed-related value no longer fit into a 16-bit number, the conversion failed and the guidance system shut down. It is one of the most expensive software bugs ever recorded.",
    tags: ["techhistory", "space", "softwarebug"],
  },
  {
    niche: "tech",
    hook: "A spreadsheet limit hid nearly 16,000 COVID cases in England.",
    body: "In October 2020, Public Health England found that 15,841 positive results had been left out of the daily figures. Lab data was being loaded into an old Excel file format that only holds about 65,000 rows, so anything past the limit was silently cut off. The cases were added back days later, delaying contact tracing.",
    tags: ["techhistory", "excel", "data"],
  },
  {
    niche: "tech",
    hook: "Kodak invented the digital camera in 1975.",
    body: "Engineer Steven Sasson built it: it weighed about 8 pounds, took black-and-white pictures of 0.01 megapixels, and needed 23 seconds to save each one to a cassette tape. Kodak earned money from the patents but kept betting on film. In 2012, the company that invented digital photography filed for bankruptcy.",
    tags: ["techhistory", "kodak", "business"],
  },
  {
    niche: "tech",
    hook: "Nintendo is older than the car company Ford.",
    body: "Fusajiro Yamauchi founded Nintendo in Kyoto in 1889 to make hanafuda playing cards. Ford was founded in 1903. Over the decades Nintendo also tried a taxi service and instant rice before toys and video games took over.",
    tags: ["nintendo", "gaming", "techhistory"],
  },
  {
    niche: "tech",
    hook: "Y2K didn't destroy the world — because people spent years fixing it.",
    body: "Old software stored years as two digits, so 2000 could be read as 1900. Governments and companies around the world spent hundreds of billions of dollars checking and fixing code. When 1 January 2000 arrived, only small problems appeared. It's remembered as a joke, but it was a success.",
    tags: ["y2k", "techhistory", "programming"],
  },
  {
    niche: "finance",
    hook: "In 2000, Netflix offered to sell itself to Blockbuster for $50 million.",
    body: "Netflix co-founders Reed Hastings and Marc Randolph pitched the deal in Dallas. Blockbuster turned it down. Ten years later, in 2010, Blockbuster filed for bankruptcy, and Netflix went on to become one of the biggest entertainment companies in the world.",
    tags: ["business", "netflix", "blockbuster"],
  },
  {
    niche: "finance",
    hook: "Apple's third co-founder sold his 10% stake for $800.",
    body: "Ronald Wayne helped start Apple with Steve Jobs and Steve Wozniak in April 1976 and drew its first logo. Twelve days later he sold his share back for $800, worried about being personally liable for the company's debts. He later took another $1,500 to give up any claims.",
    tags: ["apple", "business", "techhistory"],
  },
  {
    niche: "finance",
    hook: "Someone once paid 10,000 Bitcoin for two pizzas.",
    body: "On 22 May 2010, programmer Laszlo Hanyecz offered 10,000 BTC to anyone who would buy him two pizzas, and another user had two Papa John's pizzas delivered. At later Bitcoin prices those coins were worth hundreds of millions of dollars. Fans now celebrate 22 May as Bitcoin Pizza Day.",
    tags: ["bitcoin", "crypto", "business"],
  },
  {
    niche: "finance",
    hook: "Coca-Cola changed its formula in 1985. It lasted 79 days.",
    body: "New Coke launched on 23 April 1985. Customers flooded the company with angry calls and letters. On 11 July 1985 Coca-Cola announced the return of the original as Coca-Cola Classic. Some business historians call it the most famous product flop ever.",
    tags: ["business", "marketing", "newcoke"],
  },
  {
    niche: "finance",
    hook: "Enron was named 'America's Most Innovative Company' six years in a row. Then it collapsed.",
    body: "Fortune magazine gave Enron that title every year from 1996 to 2001. Behind the scenes the company was hiding huge debts with accounting tricks. When the truth came out, Enron filed for bankruptcy in December 2001, thousands of employees lost their jobs and retirement savings, and its auditor Arthur Andersen fell with it.",
    tags: ["business", "enron", "history"],
  },
  {
    niche: "finance",
    hook: "The McDonald brothers sold the McDonald's name in 1961 — and lost the right to use it.",
    body: "Ray Kroc bought out Richard and Maurice McDonald for $2.7 million. The brothers kept their original restaurant but had to rename it The Big M. Kroc then opened a McDonald's nearby. The brothers later said a promised royalty was only agreed on a handshake and was never paid.",
    tags: ["business", "mcdonalds", "history"],
  },
];

/** A second finished video plan (true story, ~55 seconds). */
export const GIMLI_VIDEO = {
  titles: ["The Jet That Ran Out of Fuel at 41,000 Feet", "The Gimli Glider", "A Units Mix-Up Nearly Downed a Jet"],
  hook: "In 1983, a brand-new jet ran out of fuel at 41,000 feet.",
  caption: "In 1983, a units mix-up left a brand-new Boeing 767 with half the fuel it needed. The captain glided it home.",
  hashtags: ["aviation", "history", "gimliglider", "truestory", "didyouknow"],
  cta: "Follow for more true stories that sound made up.",
  thumbnail: { text: "OUT OF FUEL", prompt: "Silent airliner gliding over flat green prairie at golden hour, engines dark, dramatic sky, vertical 9:16, empty space at the top for text" },
  voice: "Calm, precise documentary narrator, about 155 words per minute; a short pause after 'Both engines stopped.'",
  music: "Low tense synth pulse that drops out when the engines stop, then a slow rising build to the landing; ends on a soft resolve.",
  scenes: [
    { time: "0:00–0:04", narration: "On July 23, 1983, a brand-new Boeing 767 ran out of fuel at 41,000 feet.", onScreen: "OUT OF FUEL · 41,000 FT", visual: "Stock: \"airplane flying above clouds\"", motion: "Slow push-in", sfx: "Engine hum" },
    { time: "0:04–0:06", narration: "Both engines stopped.", onScreen: "BOTH ENGINES: OFF", visual: "Stock: \"airplane cockpit instruments\"", motion: "Hard cut, hold", sfx: "Hum cuts to silence" },
    { time: "0:06–0:11", narration: "The fuel gauges weren't working, so the crew worked out the fuel by hand.", onScreen: "GAUGES DOWN", visual: "Stock: \"calculator and paper close up\"", motion: "Slow pan", sfx: "" },
    { time: "0:11–0:17", narration: "But this was Air Canada's new metric jet, and the math used pounds instead of kilograms.", onScreen: "POUNDS ≠ KILOGRAMS", visual: "Stock: \"airplane refueling\"", motion: "Text pop on 'pounds'", sfx: "Soft hit" },
    { time: "0:17–0:21", narration: "It took off with less than half the fuel it needed.", onScreen: "< HALF THE FUEL", visual: "Stock: \"airplane taking off\"", motion: "Speed ramp", sfx: "Whoosh" },
    { time: "0:21–0:26", narration: "Luckily, Captain Bob Pearson was an experienced glider pilot.", onScreen: "THE CAPTAIN FLEW GLIDERS", visual: "Stock: \"glider plane soaring\"", motion: "Slow drift", sfx: "Wind" },
    { time: "0:26–0:31", narration: "His first officer knew an old air force base nearby: Gimli, Manitoba.", onScreen: "GIMLI, MANITOBA", visual: "Stock: \"aerial view prairie farmland\"", motion: "Slow zoom out", sfx: "" },
    { time: "0:31–0:36", narration: "Part of it was now a racetrack, and people were on it that day.", onScreen: "NOW A RACETRACK", visual: "Stock: \"drag racing strip\"", motion: "Whip pan", sfx: "Distant engines" },
    { time: "0:36–0:42", narration: "Coming in too high, Pearson slipped the jet sideways to lose height fast.", onScreen: "SIDESLIP", visual: "AI image: airliner banking steeply over fields, 1980s look, no logos", motion: "Tilt with the bank", sfx: "Rushing air" },
    { time: "0:42–0:47", narration: "The nose gear collapsed as it touched down, and the jet scraped to a stop.", onScreen: "TOUCHDOWN", visual: "Stock: \"airplane landing on runway\"", motion: "Shake on impact", sfx: "Screech" },
    { time: "0:47–0:52", narration: "No one on board was killed, and the plane kept flying until 2008.", onScreen: "EVERYONE LIVED", visual: "Stock: \"airplane at sunset\"", motion: "Slow push-in", sfx: "Music resolves" },
    { time: "0:52–0:55", narration: "They called it the Gimli Glider.", onScreen: "THE GIMLI GLIDER", visual: "Stock: \"airplane gliding sky\"", motion: "Hold, cut on last word", sfx: "" },
  ],
  loopLine: "\"They called it the Gimli Glider.\" cuts back to the opening line about running out of fuel.",
  factCheck: [
    "Air Canada Flight 143, 23 July 1983, Boeing 767",
    "Fuel worked out manually after a fuel-gauge fault; pounds/kilograms conversion error",
    "Both engines failed at about 41,000 feet",
    "Captain Robert Pearson was an experienced glider pilot; First Officer Maurice Quintal knew RCAF Station Gimli",
    "Landed at the former Gimli base, partly used as a racing strip; nose gear collapsed; no deaths",
    "Aircraft returned to service and was retired in 2008",
  ],
  moneyAngle: "Aviation and engineering stories carry high RPMs, and the clear problem → twist → rescue arc holds viewers to the end.",
};

const TEXT_PLATFORMS: Platform[] = ["x", "facebook", "linkedin", "instagram"];
const VIDEO_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube", "facebook"];

/**
 * Adds ready-made drafts for the given platforms: up to `perPlatform` new text posts each, plus the two
 * finished video plans for video platforms. Skips anything already added, so it can be pressed again for more.
 */
export async function addStarterContent(platforms: Platform[], settings: Settings, perPlatform = 6) {
  const existing = new Set((await listPosts()).map((p) => `${p.platform}|${p.hook}`));
  const out: Post[] = [];
  const t = nowIso();
  for (const platform of platforms) {
    if (TEXT_PLATFORMS.includes(platform)) {
      const fresh = STARTER_STORIES.filter((s) => !existing.has(`${platform}|${s.hook}`)).slice(0, perPlatform);
      for (const s of fresh) {
        const spec = PLATFORM_SPECS[platform];
        const post: Post = {
          id: uid("post"),
          platform,
          pillar: PILLAR[s.niche],
          format: spec.formats.includes("short") ? "short" : spec.formats[0],
          kind: "text",
          hook: s.hook,
          body: s.body,
          parts: [],
          hashtags: s.tags.slice(0, spec.maxHashtags),
          cta: CTA,
          offerId: null,
          status: "draft",
          moneyScore: 0,
          revenue: { low: 0, high: 0, basis: "" },
          scoreNotes: [],
          safetyFlags: [],
          attempts: 0,
          createdAt: t,
          updatedAt: t,
        };
        out.push(finalizePost(post, settings));
      }
    }
    if (VIDEO_PLATFORMS.includes(platform)) {
      for (const [v, style] of [
        [EXAMPLE_VIDEO, "funny"],
        [GIMLI_VIDEO, "true"],
      ] as const) {
        if (existing.has(`${platform}|${v.titles[0]}`)) continue;
        out.push(videoPost(v, { platform, niche: style === "funny" ? "edu" : "transport", style, length: "s60" }, settings));
      }
    }
  }
  if (out.length) await savePosts(out);
  return out;
}
