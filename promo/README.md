# Southern Heat ad

A trailer and subscribe page for **Grand Theft: Southern Heat**.

- `index.html`: the landing page. It plays a 33-second animated trailer with its own soundtrack, shows the content the channel can make from the game, and has subscribe buttons, a copy-link box and a share button.
- `video/`: the trailer exported as MP4 with sound. `southern-heat-ad-16x9.mp4` is 1920×1080 for YouTube and websites. `southern-heat-ad-9x16.mp4` is 1080×1920 for Shorts, Reels and TikTok.
- `shots/`: stills captured from the game engine. Nothing in the ad is mocked up.

## Set your subscribe link

Edit `subscribeUrl` (and optionally `handle`) in `js/config.js`. Until you do, the page shows a setup notice. You can also override the values in the address bar:

```
promo/?sub=https://www.youtube.com/@yourchannel?sub_confirmation=1&handle=@yourchannel
```

## Run it

Serve the repo root over HTTP (ES modules don't load from `file://`):

```bash
python3 -m http.server 8765    # then open http://localhost:8765/promo/
```

## How it's made

- `js/trailer.js` draws every frame of the trailer on a canvas as a function of time, with cuts locked to the music's bar grid.
- `js/music.js` synthesises the score with the Web Audio API: a dark half-time trap cue in F minor with 808s, claps, hi-hat rolls, pads, plucks, risers, impacts and a "braam" on the title.
- `tools/export.mjs` renders the same trailer frame by frame in headless Chromium, renders the score with an `OfflineAudioContext`, and encodes both with ffmpeg. To re-export after changing the handle:

```bash
python3 -m http.server 8765 &
node promo/tools/export.mjs --handle @yourchannel
```

Fonts: Anton and Inter, both under the SIL Open Font License (see `fonts/`).
