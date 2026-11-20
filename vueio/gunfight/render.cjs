// Renders scene.html frame by frame in headless Chromium and pipes the frames to ffmpeg.
//   node render.cjs out/video.mp4                       1080p H.264 (no audio)
//   node render.cjs out/seg0.mp4 --scale 4 --range 0:270 one 8K HEVC segment (frames 0..269)
//   node render.cjs --stills 1.5,12.6 dir [--scale 4]    single frames as PNGs, for checking
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = __dirname;
const cues = JSON.parse(fs.readFileSync(path.join(dir, 'cues.json'), 'utf8'));
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const scale = Number(opt('--scale', 1));
const frames = Math.round(cues.duration * cues.fps);
const [r0, r1] = opt('--range', `0:${frames}`).split(':').map(Number);
cues.renderScale = scale;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.addInitScript(`window.CUES = ${JSON.stringify(cues)};`);
  await page.goto('file://' + path.join(dir, 'scene.html'));
  await page.waitForFunction('window.READY === true', null, { timeout: 60000 });
  // 8K frames go over as high-quality JPEG (PNG encoding at 33 MP is several times slower).
  const fmt = scale > 1 ? ['image/jpeg', 0.96] : ['image/png'];
  const grab = t => page.evaluate(([t, f]) => { window.render(t); return document.getElementById('c').toDataURL(...f); }, [t, fmt]);

  if (argv[0] === '--stills') {
    const times = argv[1].split(',').map(Number), outDir = argv[2];
    fs.mkdirSync(outDir, { recursive: true });
    for (const t of times) {
      const url = await grab(t);
      fs.writeFileSync(path.join(outDir, `f_${t.toFixed(3)}.${scale > 1 ? 'jpg' : 'png'}`), Buffer.from(url.split(',')[1], 'base64'));
    }
  } else {
    const out = argv[0];
    const enc = scale > 1
      ? ['-c:v', 'libx265', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
         '-x265-params', 'log-level=error:pools=2:aq-mode=3']
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-tune', 'film'];
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(cues.fps),
      '-c:v', scale > 1 ? 'mjpeg' : 'png', '-i', '-', ...enc, out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const started = Date.now();
    for (let i = r0; i < r1; i++) {
      const url = await grab(i / cues.fps);
      const buf = Buffer.from(url.split(',')[1], 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if ((i - r0) % 30 === 0) console.log(`[${path.basename(out)}] frame ${i - r0}/${r1 - r0}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
    console.log('wrote', out);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
