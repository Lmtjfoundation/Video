# Test → deploy → store checklist

## 1. Test (automatic)
- `npm run check` runs the typecheck and the tests. GitHub Actions runs the same plus a production build on every push to `nexus-pulse-autopilot` and on every pull request (`.github/workflows/ci.yml`).
- Manual smoke test on a staging copy (see step 2): sign up, write a post, schedule it, connect the webhook to a free catch URL (for example a Make or Zapier "catch webhook"), press **Send test message**, then schedule a post and confirm it arrives.

## 2. Deploy
- Production runs on Azure: https://ghostpost.eastus.cloudapp.azure.com. Pushing to the `nexus-pulse-autopilot` branch redeploys it within about 2 minutes.
- To test safely first, run a second copy (a "staging" VM) with its own `ENCRYPTION_KEY`, `APP_URL` and Stripe **test** keys. Never point staging at your production database.
- Required production variables are listed in `.env.example`: `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`, `APP_URL`, `CRON_SECRET`, and Supabase keys if you use Supabase.
- Optional: `ANTHROPIC_PREMIUM_MODEL` (defaults to `claude-opus-5-5`) is the strongest model used for long scripts on Pro and Unlimited.

### About "Pro" and your Claude subscription
A Claude Pro or Max subscription is for the Claude apps. It doesn't give a hosted product like this one API access. The app calls the Claude API with an API key from console.anthropic.com, billed separately by usage. Put that key in Admin → App settings → Integrations. If AI writing says it's unavailable, the dashboard shows the exact reason (for example, no API credit left).

## 3. Connect-your-apps (what you still do once)
Each platform needs a developer app registered by you (the owner); customers then just press Connect. Use the Setup Wizard on the Platforms tab.
- Meta (Facebook, Instagram): customers other than people with a role on your app can connect only after Meta App Review and Business Verification.
- TikTok: unaudited apps can only create private drafts.
- X: posting and reading replies at volume need a paid X API plan.
- The webhook connector needs no registration.

## 4. App Store (Apple) — needs a Mac with Xcode
1. Enroll in the Apple Developer Program (annual fee).
2. `cd mobile && npm install && export APP_URL=https://ghostpost.eastus.cloudapp.azure.com && npx cap add ios && npm run assets && npx cap sync && npm run ios`.
3. In Xcode: choose your team, set version and build number, Product → Archive → Distribute App → App Store Connect.
4. In App Store Connect: paste text from `docs/STORE_LISTING.md`, upload `brand/app-store-icon-1024.png` and real screenshots, fill App Privacy, add the demo account in App Review notes, then submit for review.
5. Expect review questions about "minimum functionality" (Guideline 4.2) and subscriptions (3.1.1). The notes in the listing explain both.

## 5. Google Play — needs Android Studio
1. Create a Play Console developer account (one-time fee).
2. `cd mobile && npx cap add android && npm run assets && npx cap sync && npm run android`, then Build → Generate Signed Bundle (.aab). Keep the keystore safe; losing it blocks updates unless you use Play App Signing.
3. In Play Console: create the app, upload the .aab to an internal or closed test first, complete Data safety and Content rating, add `brand/play-store-icon-512.png` and screenshots, then promote to production.
4. Check Play's current requirements for new developer accounts (testing period) and target API level before you plan the date.

## 6. After launch
- Watch Admin → Overview for AI cost and health.
- Re-read each platform's developer terms every few months; they change.
