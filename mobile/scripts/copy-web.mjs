// Copies the self-contained single-file game build into www/ for Capacitor,
// adding a few app-only tweaks: edge-to-edge viewport and notch-safe controls.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '..', 'game', 'southern-heat-single.html');
const www = join(root, 'www');

const VIEWPORT_OLD = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const VIEWPORT_NEW =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">';

// Keep the HUD and touch controls clear of notches, rounded corners and the home indicator.
const APP_CSS = `<style id="app-shell">
  html, body { overscroll-behavior: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  #touch .stick { left: calc(22px + env(safe-area-inset-left)); bottom: calc(26px + env(safe-area-inset-bottom)); }
  #touch .btns { right: calc(14px + env(safe-area-inset-right)); bottom: calc(18px + env(safe-area-inset-bottom)); }
  body.touch #minimapWrap { right: calc(12px + env(safe-area-inset-right)); top: calc(12px + env(safe-area-inset-top)); }
  body.touch #topright { right: calc(176px + env(safe-area-inset-right)); top: calc(10px + env(safe-area-inset-top)); }
  /* On short landscape phones the right column is taken by the buttons, so the
     district name and speedometer move to the free space at bottom centre. */
  body.touch #zone { top: auto; right: auto; left: 50%; transform: translateX(-50%); bottom: calc(10px + env(safe-area-inset-bottom)); text-align: center; white-space: nowrap; }
  body.touch #zone .district { font-size: 18px; }
  body.touch #zone .city { font-size: 12px; letter-spacing: 2px; }
  body.touch #zone .veh { font-size: 13px; }
  body.touch #speedo { top: auto; right: auto; left: 50%; transform: translateX(-50%); bottom: calc(72px + env(safe-area-inset-bottom)); text-align: center; }
  body.touch #speedo .num { font-size: 38px; }
  body.touch #speedo .alt, body.touch #speedo .unit { font-size: 12px; }
  body.touch #help { left: calc(12px + env(safe-area-inset-left)); top: calc(10px + env(safe-area-inset-top)); }
</style>
</head>`;

let html = readFileSync(src, 'utf8');
for (const [needle, label] of [[VIEWPORT_OLD, 'viewport meta'], ['</head>', '</head>']]) {
  if (!html.includes(needle)) throw new Error(`copy-web: could not find ${label} in ${src}`);
}
html = html.replace(VIEWPORT_OLD, VIEWPORT_NEW).replace('</head>', APP_CSS);

mkdirSync(www, { recursive: true });
writeFileSync(join(www, 'index.html'), html);
console.log('Built mobile/www/index.html from game/southern-heat-single.html');
