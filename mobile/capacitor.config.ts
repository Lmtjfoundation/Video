import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native app is a secure shell around your hosted Nexus Pulse (same login, same data).
 * Set APP_URL to your live https address before running `npx cap sync`.
 */
const APP_URL = process.env.APP_URL ?? "https://your-app-domain.com";

const config: CapacitorConfig = {
  appId: "com.nexuspulse.app",
  appName: "Nexus Pulse",
  webDir: "www",
  server: {
    url: APP_URL,
    cleartext: false,
    // Platform sign-in pages (X, Facebook, Google…) open in the system browser, not inside the app.
    allowNavigation: [new URL(APP_URL).host],
  },
  // Lets the web app recognise the native app (it hides in-app purchase buttons to follow store rules).
  appendUserAgent: "NexusPulseApp",
  ios: { contentInset: "always", backgroundColor: "#07080b" },
  android: { backgroundColor: "#07080b" },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: "#07080b", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#07080b" },
  },
};

export default config;
