# Video

Ai vids — motion graphics generated with [Remotion](https://www.remotion.dev), a framework for making videos with React and TypeScript.

## Setup

Requires Node.js 18+.

```bash
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Open Remotion Studio (live preview and props editor in the browser) |
| `npm run render` | Render the `TitleCard` composition to `out/title-card.mp4` |
| `npm run still` | Render frame 60 of `TitleCard` to `out/title-card.png` |
| `npm run render:talking` | Render the `TalkingCharacter` composition to `out/talking-character.mp4` |
| `npm run record` | Open the Voice Booth recorder at http://localhost:3100 |
| `npm run use-recording -- <file>` | Make a recording the character's voice, with captions |
| `npm run typecheck` | Type-check the project |

Render any composition with custom props:

```bash
npx remotion render TitleCard out/custom.mp4 --props='{"title":"Hello","subtitle":"World","accent":"#ff5c8a"}'
```

## Project layout

- `src/index.ts` — entry point that registers the root
- `src/Root.tsx` — lists every composition (id, size, fps, duration, default props)
- `src/TitleCard.tsx` — example animated title card (spring and interpolate animations)
- `remotion.config.ts` — CLI render settings

To add a new video, create a component in `src/` and register it as another `<Composition>` in `src/Root.tsx`.

## Talking character

`TalkingCharacter` animates a single still image as a 2D cutout puppet (1080x1920, vertical):

- **Talking:** the lower jaw (lip, lower teeth, chin and beard) is a separate layer that slides down to show a mouth interior. How far it opens on each frame follows the loudness of `public/voice.wav`.
- **Blinking:** eyelids sweep down every few seconds.
- **Body motion:** idle sway and breathing, plus a gesture per spoken line (`lean`, `nod`, `tilt`, `shake`).
- **Captions:** each line pops in, timed from `public/captions.json`.

### Record your own voice

**On your computer:** run `npm run record` and open http://localhost:3100 in Chrome, Edge or Firefox. The Voice Booth shows your lines as a teleprompter and has a level meter. Record as many takes as you like, play them back, and press **Save to project** on the one you want. It is saved as a WAV in `recordings/`.

**On your phone:** record with Voice Memos (iPhone) or Recorder (Android), then upload the file on the Voice Takes page Claude published for this project. Ask Claude to use your latest take.

Then put the take in the video:

```bash
pip install faster-whisper numpy   # once
npm run use-recording -- recordings/take-2026-09-25T01-16-42.wav
npm run render:talking
```

`use-recording` accepts any audio or video file: voice memos (M4A, including lossless), WhatsApp and Telegram voice notes (OPUS/OGG), Android recordings (AMR/3GP), MP3, WAV, FLAC, CAF, WMA, WebM, and videos with sound (MP4/MOV). Install [ffmpeg](https://ffmpeg.org/download.html) for the full set of formats; without it the script falls back to Remotion's bundled ffmpeg, which can't read AMR, ALAC, CAF or WMA. It converts the file, evens out the volume, trims silence at both ends, and transcribes it to write `public/voice.wav` and `public/captions.json`. It also picks a gesture per caption: `shake` for lines starting with "no" or "nah", `tilt` for questions, `lean` for the first line and exclamations, `nod` otherwise. Fix any misheard words or change gestures in `public/captions.json` before rendering. For better transcription, add `--model small.en`.

### Change what he says with text-to-speech

The voice uses [Piper](https://github.com/rhasspy/piper), a free offline text-to-speech tool.

1. Install Piper and download a voice (the commands are at the top of `scripts/make_voice.py`).
2. Edit `LINES` in `scripts/make_voice.py` with the text, the pause after each line, and a gesture.
3. Run `python3 scripts/make_voice.py`, then `npm run render:talking`.

The video length follows the audio automatically. You can also drop in your own recording as `public/voice.wav` and edit `public/captions.json` by hand.

### Use a different character image

1. Replace `public/character/source.jpg`.
2. Update the mouth and jaw coordinates in `scripts/prepare_character.py` and `src/talking/rig.ts`, and the eye coordinates in `src/talking/rig.ts`.
3. Run `python3 scripts/prepare_character.py` (requires `pip install pillow numpy`).

## License note

Remotion is free for individuals, non-profits and companies with up to 3 employees; larger for-profit companies need a [company license](https://www.remotion.dev/license).
