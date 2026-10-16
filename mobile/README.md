# Ghost Post — iOS & Android apps

You get the mobile app two ways:

1. **Installable web app (works today, free).** Open your Ghost Post address on a phone:
   - iPhone: Safari → Share → **Add to Home Screen**.
   - Android: Chrome → menu → **Install app**.
   It opens full-screen with its own icon, bottom tab bar and offline screen.

2. **App Store / Google Play apps (this folder).** A native shell built with Capacitor that loads your hosted app,
   so every web update reaches the phone apps instantly with no new app release.

## Build the store apps

You need a Mac with Xcode for iOS, and Android Studio for Android.

```bash
cd mobile
npm install
export APP_URL=https://ghost-post-autopilot.up.railway.app   # your deployed Ghost Post (or your custom domain)
npx cap add ios
npx cap add android
npm run assets        # generates every icon and splash size from assets/icon.png
npx cap sync
npm run ios           # opens Xcode → pick your team → Product → Archive → Distribute
npm run android       # opens Android Studio → Build → Generate Signed Bundle (.aab)
```

Accounts you'll need: Apple Developer Program ($99/year) and Google Play Console (one-time $25).

## Store rules that matter for this app

- **Subscriptions.** Selling digital subscriptions inside an iOS app normally requires Apple In-App Purchase.
  The app recognises it is running natively and **hides purchase buttons** — people subscribe on your website,
  which is the safest default. In the US storefront, Apple now allows a link to outside checkout with an
  entitlement and a commission; outside the US the rules differ by region. Google Play has similar billing rules.
  Check the current Apple and Google policies before adding purchase links to the app.
- **Minimum functionality (Apple 4.2).** Apple rejects apps that are "just a website". Ghost Post is a full
  tool with accounts, scheduling and uploads, which helps — make sure your App Store screenshots show it.
- **Sign in with Apple.** Not required, because the app only uses email + password sign-in (no Google/Facebook login).
- **Account deletion.** Apple requires in-app account deletion: it's in Settings → Account → Delete account
  (cancels the subscription and erases the user's data).
- **Content.** Mature mode is X-only and non-explicit. Set your App Store age rating honestly (likely 17+ if you
  keep mature mode available).
