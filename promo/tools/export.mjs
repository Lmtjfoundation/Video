// Export the trailer to MP4 (H.264 + AAC) in widescreen and vertical.
// Usage (from the repo root, with a static server on port 8765):
//   python3 -m http.server 8765 &
//   node promo/tools/export.mjs [--handle @yourchannel] [--fps 30]
// Needs Node with Playwright and ffmpeg on the PATH.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const FPS = +opt('fps', 30);
const HANDLE = opt('handle', '');
const BASE = opt('base', 'http://localhost:8765/promo/tools/render.html');
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../video');
mkdirSync(outDir, { recursive: true });

const FORMATS = [
  { name: 'southern-heat-ad-16x9', w: 1920, h: 1080 },
  { name: 'southern-heat-ad-9x16', w: 1080, h: 1920 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const wav = path.join(outDir, 'soundtrack.wav');
await page.goto(`${BASE}?w=16&h=9`);
await page.waitForFunction(() => window.ready);
writeFileSync(wav, Buffer.from(await page.evaluate(() => window.renderAudio()), 'base64'));
console.log('soundtrack rendered');

for (const f of FORMATS) {
  await page.setViewportSize({ width: 400, height: 400 });
  await page.goto(`${BASE}?w=${f.w}&h=${f.h}&handle=${encodeURIComponent(HANDLE)}`);
  await page.waitForFunction(() => window.ready);
  const length = await page.evaluate(() => window.LENGTH);
  const frames = Math.ceil((length + 1.2) * FPS); // hold black while the reverb tails off
  const out = path.join(outDir, `${f.name}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-af', `afade=t=out:st=${(length + 0.6).toFixed(2)}:d=0.6`, '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < frames; i++) {
    const data = await page.evaluate((t) => window.renderFrame(t), i / FPS);
    if (!ff.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`${f.name}: frame ${i}/${frames}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('wrote', out);
}
await browser.close();
