// Renders scene.html frame by frame in headless Chromium and pipes PNG frames to ffmpeg.
//   node render.cjs out/video.mp4          full render (no audio)
//   node render.cjs --stills 1.5,12.6 dir  single frames as PNGs, for checking
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = __dirname;
const cues = JSON.parse(fs.readFileSync(path.join(dir, 'cues.json'), 'utf8'));
const args = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: cues.width, height: cues.height } });
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.addInitScript(`window.CUES = ${JSON.stringify(cues)};`);
  await page.goto('file://' + path.join(dir, 'scene.html'));
  await page.waitForFunction('window.READY === true', null, { timeout: 60000 });
  const grab = t => page.evaluate(t => { window.render(t); return document.getElementById('c').toDataURL('image/png'); }, t);

  if (args[0] === '--stills') {
    const times = args[1].split(',').map(Number), outDir = args[2];
    fs.mkdirSync(outDir, { recursive: true });
    for (const t of times) {
      const url = await grab(t);
      fs.writeFileSync(path.join(outDir, `f_${t.toFixed(3)}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
  } else {
    const out = args[0] || path.join(dir, 'out', 'video.mp4');
    const frames = Math.round(cues.duration * cues.fps);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(cues.fps), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-tune', 'film', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const url = await grab(i / cues.fps);
      const buf = Buffer.from(url.split(',')[1], 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 60 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
    console.log('wrote', out);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
