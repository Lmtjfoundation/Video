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

## License note

Remotion is free for individuals, non-profits and companies with up to 3 employees; larger for-profit companies need a [company license](https://www.remotion.dev/license).
