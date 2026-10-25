import "server-only";
import { asUser, gdb, GLOBAL } from "./db";
import { catalog } from "./library";
import { GENRES, MOODS, type AssetKind } from "./library-tags";
import { PRESETS } from "./presets";
import { autoPrompt, makeMusic, makeSfx } from "./sound-studio";

/**
 * Fills the shared catalog so subscribers find music and sound effects on day one, the way a stock library opens
 * full: the admin picks how many, and the engine works through a fixed list of recipes in the background (genre ×
 * mood pairs for music, everyday and cinematic sounds for effects). Recipes already made are skipped, so running it
 * again adds new ones instead of repeats.
 */
const DONE = "catalog-fill-done";

/** Instruments that suit each genre, so each recipe reads like a real brief. */
const LEAD: Partial<Record<(typeof GENRES)[number], string>> = {
  Cinematic: "orchestral strings, deep drums and piano", "Hip hop": "boom-bap drums, vinyl samples and warm bass", Trap: "808 bass, rolling hi-hats and dark bells",
  "R&B": "silky electric piano, deep bass and finger snaps", Soul: "Rhodes, horns and a tight groove", Pop: "bright synths, claps and a catchy hook",
  Rock: "driving electric guitars, bass and live drums", Indie: "jangly guitars, soft drums and warm bass", Electronic: "analog synths, punchy kick and arpeggios",
  House: "four-on-the-floor kick, piano stabs and a rolling bassline", "Lo-fi": "dusty Rhodes, vinyl crackle and soft drums", Ambient: "evolving pads, soft textures and gentle piano",
  Jazz: "upright bass, brushed drums and saxophone", Blues: "slide guitar, harmonica and a shuffle beat", Classical: "string quartet and piano",
  Orchestral: "full orchestra, brass and timpani", Piano: "solo grand piano", Acoustic: "acoustic guitar, light percussion and cello",
  Folk: "fingerpicked guitar, banjo and fiddle", Country: "twangy guitar, pedal steel and a steady beat", Funk: "slap bass, wah guitar and tight drums",
  Gospel: "Hammond organ, choir and hand claps", Latin: "congas, nylon guitar and brass", Afrobeats: "log drums, shakers and a sunny guitar riff",
  Reggae: "offbeat guitar skank, deep bass and one-drop drums", Drill: "sliding 808s, sharp hi-hats and dark piano", Synthwave: "retro analog synths and gated drums",
  Corporate: "bright piano, plucked guitar and light claps", Children: "xylophone, ukulele and playful whistles", World: "hand drums, flutes and plucked strings",
};
/** Moods that make sense for each genre (not every pair does: no "Angry Children"). */
const FITS = (g: string, m: string) => !(g === "Children" && /Angry|Dark|Tense|Sexy|Sad|Melancholy|Suspense|Mysterious/.test(m)) && !(g === "Corporate" && /Angry|Dark|Sexy/.test(m)) && !(g === "Gospel" && /Sexy|Angry/.test(m));

export function musicRecipes() {
  const out: { id: string; prompt: string; seconds: number; genres: string[]; moods: string[] }[] = [];
  for (const p of PRESETS.filter((x) => x.kind === "music")) out.push({ id: `preset-${p.id}`, prompt: p.prompt, seconds: p.seconds ?? 120, genres: p.genres ?? [], moods: p.moods ?? [] });
  // Then every genre with three moods, spread so a partial fill covers many genres.
  for (let round = 0; round < 3; round++) {
    GENRES.forEach((g, i) => {
      const fit = MOODS.filter((m) => FITS(g, m));
      const m = fit[(i * 5 + round * 7) % fit.length];
      out.push({ id: `${g}-${m}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"), prompt: `${m} ${g.toLowerCase()} instrumental with ${LEAD[g] ?? "a full arrangement"}`, seconds: [120, 90, 150][round], genres: [g], moods: [m] });
    });
  }
  return out;
}

const SOUNDS: [string, string][] = [
  ["Weather", "Light rain on leaves, gentle and steady"], ["Weather", "Thunder rolling in the distance, deep rumble"], ["Weather", "Strong wind howling around a house"],
  ["Nature", "Ocean waves breaking on a sandy beach"], ["Nature", "Crickets at night in a quiet field"], ["Nature", "Mountain stream flowing over rocks"],
  ["Animals", "Dog barking twice in a backyard"], ["Animals", "Seagulls calling over a harbor"], ["Animals", "Horse galloping on dirt"],
  ["City", "Busy city street with traffic and distant horns"], ["City", "Subway train arriving at a station"], ["City", "Construction jackhammer down the street"],
  ["Vehicles", "Motorcycle revving and speeding away"], ["Vehicles", "Truck air brakes hissing"], ["Vehicles", "Helicopter passing overhead"],
  ["Doors", "Car door closing, solid thud"], ["Doors", "Old wooden door creaking open slowly"], ["Doors", "Metal gate clanging shut"],
  ["Footsteps", "High heels walking on a marble floor"], ["Footsteps", "Running footsteps on gravel"], ["Footsteps", "Footsteps crunching through snow"],
  ["Impacts", "Punch hitting a body, heavy and close"], ["Impacts", "Deep cinematic trailer hit with a long tail"], ["Impacts", "Wooden crate dropped on concrete"],
  ["Whooshes", "Short fast whoosh for a cut"], ["Whooshes", "Heavy deep whoosh passing slowly"], ["Transitions", "Glitchy digital transition swoosh"],
  ["Risers", "Rising orchestral tension swell"], ["Risers", "Electronic riser building to a drop"], ["Household", "Kettle whistling on a stove"],
  ["Household", "Coffee being poured into a mug"], ["Household", "Microwave beeping three times"], ["Office", "Typing fast on a mechanical keyboard"],
  ["Office", "Paper sheets shuffled and stacked"], ["Technology", "Computer startup chime, soft and modern"], ["Technology", "Camera shutter click"],
  ["Phones", "Text message notification ding"], ["Phones", "Old phone ringing in another room"], ["Crowds", "Restaurant crowd murmur and cutlery"],
  ["Crowds", "Small audience applause"], ["Human", "Man laughing softly"], ["Human", "Woman gasping in surprise"],
  ["Water", "Water dripping into a sink in a quiet bathroom"], ["Water", "Splash of a body diving into a pool"], ["Fire", "Campfire crackling close-up"],
  ["Explosions", "Distant explosion with debris falling"], ["Sci-fi", "Spaceship engine humming"], ["Sci-fi", "Laser blast zap"],
  ["Cartoon", "Cartoon boing spring"], ["Cartoon", "Slide whistle going up"], ["UI", "Soft success chime"], ["UI", "Error buzz, short"],
  ["Foley", "Zipper opening on a jacket"], ["Foley", "Keys dropped on a table"], ["Sports", "Basketball dribbling on a court"],
  ["Sports", "Referee whistle blown twice"], ["Music stingers", "Dramatic piano stinger, single chord"], ["Music stingers", "Comedic trombone wah-wah"],
];
export const sfxRecipes = () => [
  ...PRESETS.filter((p) => p.kind === "sfx").map((p) => ({ id: `preset-${p.id}`, prompt: p.prompt, seconds: p.seconds ?? 5, category: p.category })),
  ...SOUNDS.map(([category, prompt]) => ({ id: prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50), prompt, seconds: /ambience|steady|flowing|murmur|crickets|waves|traffic|humming|crackling/i.test(prompt) ? 20 : 4, category })),
];

const doneIds = async () => ((await gdb().get<{ id: string; value: string[] }>("kv", DONE))?.value ?? []);
const markDone = async (id: string) => gdb().upsert("kv", { id: DONE, value: [...(await doneIds()), id] });

/** Which recipes are left to make. */
export async function fillStatus() {
  const done = new Set(await doneIds());
  const cat = await catalog();
  return {
    music: { left: musicRecipes().filter((r) => !done.has(`music:${r.id}`)).length, inCatalog: cat.filter((a) => a.kind === "music").length },
    sfx: { left: sfxRecipes().filter((r) => !done.has(`sfx:${r.id}`)).length, inCatalog: cat.filter((a) => a.kind === "sfx").length },
  };
}

/**
 * Makes up to `count` new catalog items of one kind. Runs as the app-wide owner, so the files and the entries
 * belong to the catalog. `polish` lets the writer turn each recipe into a richer prompt first.
 */
export async function fillCatalog(kind: Extract<AssetKind, "music" | "sfx">, count: number, onProgress?: (made: number, of: number) => void, polish = true) {
  const done = new Set(await doneIds());
  const todo = kind === "music" ? musicRecipes().filter((r) => !done.has(`music:${r.id}`)) : sfxRecipes().filter((r) => !done.has(`sfx:${r.id}`));
  const batch = todo.slice(0, Math.max(1, Math.min(200, count)));
  let made = 0;
  const failed: string[] = [];
  for (const r of batch) {
    try {
      await asUser(GLOBAL, async () => {
        if (kind === "music") {
          const m = r as ReturnType<typeof musicRecipes>[number];
          const prompt = polish ? await autoPrompt("music", m.prompt).catch(() => m.prompt) : m.prompt;
          await makeMusic(GLOBAL, { prompt, seconds: m.seconds, genres: m.genres, moods: m.moods });
        } else {
          const s = r as ReturnType<typeof sfxRecipes>[number];
          await makeSfx(GLOBAL, { prompt: s.prompt, seconds: s.seconds, category: s.category });
        }
      });
      await markDone(`${kind}:${r.id}`);
      made++;
    } catch (e) {
      failed.push(`${r.id}: ${(e as Error).message.slice(0, 120)}`);
      if (failed.length >= 3 && made === 0) throw new Error(`The engine couldn't make catalog items: ${failed[0]}`);
    }
    onProgress?.(made, batch.length);
  }
  return { made, failed };
}
