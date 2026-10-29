# ChatVue

ChatVue is a chat assistant for **Grand Theft: Southern Heat**, built with Vue 3. You can ask it about controls, cheats, missions, weapon and vehicle stats, the three cities, the code layout, or the Unreal Engine 5 build.

It runs fully offline and doesn't use an AI service. Every answer comes from this repository's READMEs or the game source, and each answer names the file it came from. If a question isn't covered, ChatVue says so instead of guessing.

## Run it

Like the game, ChatVue uses ES modules, so serve the repo over HTTP:

```bash
python3 -m http.server 8000      # from the repo root
# open http://localhost:8000/chatvue/
```

## Features

- A sidebar with topics (Start, Controls, Combat, Missions, Cheats, World, Vehicles, Tech, Unreal) and suggested follow-up questions after each answer.
- Exact figures:
  - Weapon damage, fire rate, magazine size and reload time come from `WEAPONS` in `player.js`.
  - Vehicle top speeds come from `VEHICLE_TYPES` in `vehicles.js`, converted to mph the same way the HUD does.
  - Mission rewards and time limits come from `missions.js`.
  - Cheat effects come from `main.js`.
- Cheat lookup: type a code such as `HESOYAM` and you get its exact effect.
- Light and dark themes (auto, dark or light), soft WebAudio UI sounds with a mute button, and a copy button on every answer.
- Your conversation, theme and sound settings are saved in `localStorage`. If storage is unavailable, ChatVue still works.
- A responsive layout with a slide-in topic drawer on phones. It also respects `prefers-reduced-motion`.

## Code layout

```
chatvue/
  index.html        layout, styles and the Vue template
  js/app.js         Vue app: messages, typing state, persistence, theme, sounds
  js/engine.js      answer engine: synonyms, stemming, IDF-weighted keyword scoring, intents
  js/knowledge.js   knowledge base built from the READMEs and game source
  lib/              vendored Vue 3.5.13 ES module build (MIT)
```

To teach ChatVue something new, add an entry to `ENTRIES` in `js/knowledge.js`. An entry has an `id`, `topic`, `title`, `keywords`, an HTML `answer`, a `source` file and optional `followups`.
