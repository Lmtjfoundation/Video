#!/usr/bin/env node
// Ghost Post on the command line. Uses your personal API key (Ghost Post → Developers → New key); nothing else.
// Node 18+ only, no packages to install. Run `ghostpost help` for everything it can do.
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const CONFIG = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "ghostpost", "config.json");
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg" };

const HELP = `Ghost Post command-line tool

Set up (once):
  ghostpost login [--url https://your-ghost-post-site]      paste your API key when asked (it isn't shown)
  Or set GHOSTPOST_URL and GHOSTPOST_KEY in the environment.

Make things (each prints the job, waits for it, and saves the result unless --no-wait):
  ghostpost image "<description>" [--aspect 9:16|16:9|1:1] [--ref face.png|med_id] [-o out.png]
      A picture on Azure's GPUs. --ref keeps that person's face in the new picture.
  ghostpost voice <video.mp4|med_id> (--say "words" [--voice af_heart] | --audio voice.wav|med_id)
                  [--lipsync] [--captions] [--mix replace|duck|swap] [-o out.mp4]
      Put a voice on any video; --lipsync moves the mouth to the new words.
  ghostpost music-video <song.mp3|med_id> "<look and story>" [--clips] [--aspect 9:16] [-o out.mp4]
  ghostpost movie "<pitch or idea>" [--length s30|s60|s90|m3] [--voice am_onyx] [--platform youtube|tiktok|instagram]
      From a one-line pitch to a narrated, finished movie.
  ghostpost music|sfx|footage "<description>" [--seconds 30]

Your files and jobs:
  ghostpost upload <file>...            add files to your Media Library (prints their ids)
  ghostpost media [--kind image|video|audio]
  ghostpost download <med_id> [-o file]
  ghostpost job <job_id> [--wait]
  ghostpost api <GET|POST|PUT|DELETE> <path> ['<json>']   any Ghost Post endpoint, for scripts

Free voices: af_heart, af_bella, af_nicole, af_sarah, am_michael, am_onyx (see the Voice Library for all).`;

// ---------- small helpers ----------
function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o") out.o = argv[++i];
    else if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--") || ["lipsync", "captions", "clips", "wait", "no-wait", "json"].includes(k)) out[k] = true;
      else (out[k] = out[k] === undefined ? next : [].concat(out[k], next)), i++;
    } else out._.push(a);
  }
  return out;
}
const die = (msg, code = 1) => {
  console.error(`ghostpost: ${msg}`);
  process.exit(code);
};
async function loadConfig() {
  let c = {};
  try {
    c = JSON.parse(await readFile(CONFIG, "utf8"));
  } catch {}
  const url = (process.env.GHOSTPOST_URL || c.url || "").replace(/\/+$/, "");
  const key = process.env.GHOSTPOST_KEY || c.key || "";
  return { url, key };
}
async function cfg() {
  const c = await loadConfig();
  if (!c.url || !c.key) die("not signed in. Run: ghostpost login --url https://your-ghost-post-site");
  return c;
}
async function call(method, p, body, { form } = {}) {
  const { url, key } = await cfg();
  const headers = { Authorization: `Bearer ${key}` };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) (headers["Content-Type"] = "application/json"), (payload = JSON.stringify(body));
  let res;
  try {
    res = await fetch(url + p, { method, headers, body: payload });
  } catch (e) {
    die(`can't reach ${url} (${e.cause?.code || e.message})`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) die(`${data.error || text.slice(0, 300)} (HTTP ${res.status})`);
  return data;
}
const isId = (s) => /^med_[A-Za-z0-9_-]+$/.test(String(s));
async function upload(files) {
  const form = new FormData();
  for (const f of files) {
    const bytes = await readFile(f).catch(() => die(`can't read ${f}`));
    const type = MIME[path.extname(f).toLowerCase()];
    if (!type) die(`${f}: use JPG, PNG, WebP, GIF, MP4, MOV, WebM, MP3, WAV, M4A or OGG`);
    form.append("files", new Blob([bytes], { type }), path.basename(f));
  }
  const r = await call("POST", "/api/media", undefined, { form });
  for (const e of r.errors || []) console.error(`  ${e}`);
  return r.saved || [];
}
/** A local file is uploaded first; a med_… id is used as it is. */
async function mediaId(x, what) {
  if (!x) die(`give the ${what}`);
  if (isId(x)) return x;
  const [m] = await upload([x]);
  if (!m) die(`couldn't upload ${x}`);
  console.error(`  uploaded ${path.basename(x)} → ${m.id}`);
  return m.id;
}
async function save(urlOrId, out, fallbackName) {
  let url = urlOrId;
  if (isId(urlOrId)) {
    const list = await call("GET", "/api/media");
    const m = (list.items || []).find((i) => i.id === urlOrId);
    if (!m) die(`no file ${urlOrId} in your Media Library`);
    url = m.url;
    fallbackName = m.name;
  }
  const { url: base } = await cfg();
  const res = await fetch(new URL(url, base));
  if (!res.ok) die(`download failed (HTTP ${res.status})`);
  const file = out || fallbackName || "ghostpost-output";
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${file}`);
}
/** Waits for a background job, then saves what it made (newest matching file in the Media Library). */
async function follow(job, opts, kindHint) {
  if (opts["no-wait"]) return console.log(`job ${job.id} started. Check it with: ghostpost job ${job.id} --wait`);
  const started = Date.now();
  let last = "";
  for (;;) {
    const j = await call("GET", `/api/v1/jobs/${job.id}`);
    const line = `${j.status}${j.progress ? ` ${Math.round(j.progress * (j.progress <= 1 ? 100 : 1))}%` : ""} ${j.message || ""}`.trim();
    if (line !== last) console.error(`  ${line}`), (last = line);
    if (j.status === "done") {
      if (j.item_id) return save(j.item_id, opts.o);
      if (!kindHint) return;
      const list = await call("GET", "/api/media");
      const made = (list.items || []).filter((m) => m.kind === kindHint && new Date(m.createdAt).getTime() >= started - 5000).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return made ? save(made.url, opts.o, made.name) : console.log("done (open Ghost Post to see it)");
    }
    if (j.status === "failed") die(j.message || "the job failed");
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const voiceChoice = (id) => ({ kind: "free", id: id || "am_michael", speed: 1 });

// ---------- commands ----------
const commands = {
  async help() {
    console.log(HELP);
  },
  async login(o) {
    const cur = await loadConfig();
    const url = String(o.url || cur.url || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(url)) die("give your Ghost Post address: ghostpost login --url https://…");
    const key = process.env.GHOSTPOST_KEY || (await secret("API key (gp_live_…): "));
    if (!/^gp_live_[A-Za-z0-9_-]{20,}$/.test(key)) die("that isn't an API key. Make one in Ghost Post → Developers.");
    await mkdir(path.dirname(CONFIG), { recursive: true });
    await writeFile(CONFIG, JSON.stringify({ url, key }, null, 2), { mode: 0o600 });
    await chmod(CONFIG, 0o600);
    const r = await call("GET", "/api/media");
    console.log(`signed in to ${url} (${(r.items || []).length} files in your Media Library). Key saved in ${CONFIG} (only you can read it).`);
  },
  async image(o) {
    const prompt = o._.join(" ").trim();
    if (!prompt) die('describe the picture: ghostpost image "a jazz club at night"');
    const ref = o.ref ? await mediaId(o.ref, "reference picture") : undefined;
    const r = await call("POST", "/api/images", { mode: ref ? "edit" : "create", prompt, aspect: o.aspect || "9:16", mediaId: ref });
    console.error(`  made ${r.name} (${r.id})`);
    await save(r.url, o.o, r.name);
  },
  async voice(o) {
    const video = await mediaId(o._[0], "video");
    let voice;
    if (o.audio) voice = { mediaId: await mediaId(o.audio, "voice recording") };
    else if (o.say) voice = { text: String(o.say), choice: voiceChoice(o.voice) };
    else die('say what the voice says: --say "…" or --audio voice.wav');
    const r = await call("POST", "/api/voice-lab", { action: "voice-to-video", videoId: video, voice, mix: o.mix || "replace", captions: !!o.captions, lipsync: !!o.lipsync });
    console.error(`  ${r.credits ?? 0} credits`);
    await follow(r.job, o, "video");
  },
  async "music-video"(o) {
    const song = await mediaId(o._[0], "song");
    const idea = o._.slice(1).join(" ").trim();
    if (!idea) die('describe the look and story: ghostpost music-video song.mp3 "neon New Orleans night, second line parade"');
    const r = await call("POST", "/api/video-tools", { action: "music-video", audioId: song, idea, aspect: o.aspect || "9:16", motion: o.clips ? "clips" : "pictures" });
    console.error(`  ${r.credits ?? 0} credits`);
    await follow(r.job, o, "video");
  },
  async movie(o) {
    const pitch = o._.join(" ").trim();
    if (!pitch) die('give the pitch: ghostpost movie "Four friends in New Orleans…"');
    const r = await call("POST", "/api/story-video", { action: "start", template: "general", source: { kind: "idea", text: pitch }, narrator: voiceChoice(o.voice || "am_onyx"), length: o.length || "s90", platform: o.platform || "youtube", instant: true });
    await follow(r.job, o, "video");
  },
  async music(o) {
    return gen("music", o);
  },
  async sfx(o) {
    return gen("sfx", o);
  },
  async footage(o) {
    return gen("footage", o);
  },
  async upload(o) {
    if (!o._.length) die("give one or more files");
    for (const m of await upload(o._)) console.log(`${m.id}\t${m.kind}\t${m.name}`);
  },
  async media(o) {
    const r = await call("GET", "/api/media");
    const items = (r.items || []).filter((m) => !o.kind || m.kind === o.kind);
    if (o.json) return console.log(JSON.stringify(items, null, 2));
    for (const m of items) console.log(`${m.id}\t${m.kind}\t${(m.size / 1048576).toFixed(1)} MB\t${m.name}`);
  },
  async download(o) {
    if (!isId(o._[0])) die("give a file id (med_…); see: ghostpost media");
    await save(o._[0], o.o);
  },
  async job(o) {
    if (!o._[0]) die("give the job id");
    if (o.wait) return follow({ id: o._[0] }, o);
    console.log(JSON.stringify(await call("GET", `/api/v1/jobs/${o._[0]}`), null, 2));
  },
  async api(o) {
    const [method, p, json] = o._;
    if (!method || !p?.startsWith("/")) die("usage: ghostpost api GET /api/media");
    console.log(JSON.stringify(await call(method.toUpperCase(), p, json ? JSON.parse(json) : undefined), null, 2));
  },
};

async function gen(kind, o) {
  const prompt = o._.join(" ").trim();
  if (!prompt) die(`describe the ${kind}`);
  const r = await call("POST", "/api/v1/generate", { kind, prompt, seconds: Number(o.seconds) || 30 });
  console.error(`  ${r.credits ?? 0} credits`);
  await follow(r.job, o);
}

function secret(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : "");
    rl.question(q, (a) => {
      rl.close();
      process.stdout.write("\n");
      resolve(a.trim());
    });
  });
}

const [cmd = "help", ...rest] = process.argv.slice(2);
const run = commands[cmd] || (["-h", "--help"].includes(cmd) ? commands.help : null);
if (!run) die(`unknown command "${cmd}". Run: ghostpost help`);
await run(parse(rest));
