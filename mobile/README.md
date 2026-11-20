# Southern Heat: mobile app (Android and iOS)

This is a Capacitor app shell that wraps the single-file game build (`game/southern-heat-single.html`) as a native app.

- Landscape only and full screen (Android immersive mode, iOS status bar hidden)
- Keeps the screen awake while you play
- Touch controls are kept clear of notches and the home indicator
- On phones, the district name and speedometer sit at bottom centre so they don't overlap the buttons
- Custom app icon and splash screen (source art is in `assets/`)

## Build

You need Node 22 and npm.

```bash
cd mobile
npm ci
npm run sync          # copies the game into www/ and updates both native projects
```

- **Android:** install Android Studio (it includes the SDK and JDK 21), then run `npm run android`. To build a debug APK from the command line, run `npm run build:android`. The APK is written to `android/app/build/outputs/apk/debug/`.
- **iOS:** you need a Mac with Xcode. Run `npm run ios`.

After you change the game, run `npm run sync` again.
