# Video
Ai vids

## 🎮 Grand Theft: Southern Heat

A GTA V-style open-world browser game set in **Dallas**, **New Orleans** and **Atlanta**. See [`game/README.md`](game/README.md).

```bash
cd game && python3 -m http.server 8000   # then open http://localhost:8000
```

### ChatVue: project assistant

[`chatvue/`](chatvue) is an offline chat guide to the game, built with Vue 3. It answers questions about controls, cheats, missions, stats and the Unreal build, using only this repo's docs and source. Serve the repo root and open `/chatvue/`. See [`chatvue/README.md`](chatvue/README.md).

### Unreal Engine 5 version

The same game is rebuilt as an Unreal Engine 5 C++ project in [`unreal/SouthernHeat`](unreal/SouthernHeat). It doesn't use any art assets: the world is generated at runtime. See its README for build steps (you'll need UE 5.4 and Visual Studio 2022).
