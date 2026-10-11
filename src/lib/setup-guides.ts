import type { Platform } from "./types";

/**
 * One-time owner setup for each platform's "Connect" button.
 * Developer portals rename menus often; steps name the setting to look for, with a direct link.
 * {REDIRECT} is replaced with this app's real callback URL in the UI.
 */
export interface SetupStep {
  text: string;
  link?: { label: string; href: string };
  copy?: "redirect" | "scopes" | "site";
  note?: string;
}
export interface SetupGuide {
  minutes: string;
  needs: string;
  idLabel: string;
  secretLabel: string;
  steps: SetupStep[];
  testing: string;
  review: string;
}

export const SETUP_GUIDES: Record<Platform, SetupGuide> = {
  x: {
    minutes: "10 minutes",
    needs: "An X account. Posting at volume needs a paid X API plan.",
    idLabel: "OAuth 2.0 Client ID",
    secretLabel: "OAuth 2.0 Client Secret",
    steps: [
      { text: "Open the X Developer Portal and sign in with the X account you'll post from. Create a Project and an App inside it.", link: { label: "Open X Developer Portal", href: "https://developer.x.com/en/portal/dashboard" } },
      { text: "In your App, find User authentication settings and choose Set up." },
      { text: "Set App permissions to Read and write, and Type of App to Web App, Automated App or Bot." },
      { text: "Paste this into Callback URI / Redirect URL:", copy: "redirect" },
      { text: "Paste this into Website URL, then Save:", copy: "site" },
      { text: "Open Keys and tokens. Under OAuth 2.0 Client ID and Client Secret, copy both values and paste them below.", note: "X shows the secret only once. If you lose it, regenerate it." },
    ],
    testing: "Works for your own account right away.",
    review: "No app review, but free API access is very limited; check X's current plans for posting and reading replies at volume.",
  },
  facebook: {
    minutes: "15 minutes",
    needs: "A Facebook Page you're an admin of. Meta doesn't let apps post to personal profiles, including profiles in professional mode.",
    idLabel: "App ID",
    secretLabel: "App Secret",
    steps: [
      { text: "Open Meta for Developers, go to My Apps, and create an app. Choose the use case for managing a Facebook Page (or Other → Business).", link: { label: "Open Meta for Developers", href: "https://developers.facebook.com/apps" } },
      { text: "Add the product Facebook Login for Business (or Facebook Login) and open its Settings." },
      { text: "Paste this into Valid OAuth Redirect URIs, then Save:", copy: "redirect" },
      { text: "Request these permissions for the app:", copy: "scopes" },
      { text: "Open App settings → Basic. Add a Privacy Policy URL, then copy the App ID and App Secret and paste them below." },
    ],
    testing: "In Development mode, only people with a role on the app (you, plus anyone you add under App roles) can connect.",
    review: "Before subscribers can connect their own Pages, submit Meta App Review for pages_manage_posts and pages_manage_engagement, and complete Business Verification.",
  },
  instagram: {
    minutes: "15 minutes",
    needs: "An Instagram Business or Creator account (Instagram app → Settings → Account type).",
    idLabel: "Instagram app ID",
    secretLabel: "Instagram app secret",
    steps: [
      { text: "Open Meta for Developers and create an app (or reuse your Facebook one).", link: { label: "Open Meta for Developers", href: "https://developers.facebook.com/apps" } },
      { text: "Add the Instagram product and choose API setup with Instagram login." },
      { text: "Under Set up Instagram business login, open Business login settings and paste this into OAuth redirect URIs:", copy: "redirect" },
      { text: "Make sure these permissions are included:", copy: "scopes" },
      { text: "Copy the Instagram app ID and Instagram app secret shown on that page and paste them below.", note: "These are different from the Facebook App ID and secret." },
    ],
    testing: "In Development mode, add your Instagram account as an Instagram tester under App roles and accept the invite in Instagram.",
    review: "Before subscribers can connect, submit App Review for instagram_business_content_publish and instagram_business_manage_comments.",
  },
  linkedin: {
    minutes: "10 minutes",
    needs: "A LinkedIn Company Page to attach the app to (LinkedIn requires one).",
    idLabel: "Client ID",
    secretLabel: "Primary Client Secret",
    steps: [
      { text: "Open LinkedIn Developers and choose Create app. Pick your Company Page and upload a logo.", link: { label: "Open LinkedIn Developers", href: "https://www.linkedin.com/developers/apps" } },
      { text: "On the Products tab, request Share on LinkedIn and Sign In with LinkedIn using OpenID Connect." },
      { text: "On the Auth tab, add this under Authorized redirect URLs:", copy: "redirect" },
      { text: "Still on the Auth tab, copy the Client ID and Primary Client Secret and paste them below." },
    ],
    testing: "Both products are usually approved instantly for posting to your own profile.",
    review: "Posting as a Company Page or reading comments needs LinkedIn's Community Management API approval.",
  },
  youtube: {
    minutes: "15 minutes",
    needs: "A Google account with a YouTube channel.",
    idLabel: "Client ID",
    secretLabel: "Client secret",
    steps: [
      { text: "Open Google Cloud Console and create a project.", link: { label: "Open Google Cloud Console", href: "https://console.cloud.google.com/projectcreate" } },
      { text: "In APIs & Services → Library, find YouTube Data API v3 and choose Enable.", link: { label: "Open API Library", href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com" } },
      { text: "Set up the OAuth consent screen (Google Auth Platform): choose External, add an app name and support email, and add your own Google account as a Test user." },
      { text: "Go to Credentials → Create credentials → OAuth client ID → Web application. Under Authorized redirect URIs, paste:", copy: "redirect", link: { label: "Open Credentials", href: "https://console.cloud.google.com/apis/credentials" } },
      { text: "Create it, then copy the Client ID and Client secret and paste them below." },
    ],
    testing: "In Testing mode, only the test users you listed can connect, and their link must be renewed every 7 days.",
    review: "Publish the app and complete Google's verification for the youtube.force-ssl scope before subscribers connect.",
  },
  tiktok: {
    minutes: "15 minutes",
    needs: "A TikTok account and a TikTok for Developers account.",
    idLabel: "Client key",
    secretLabel: "Client secret",
    steps: [
      { text: "Open TikTok for Developers, go to Manage apps, and create an app. Fill in the icon, description, terms and privacy policy URLs.", link: { label: "Open TikTok for Developers", href: "https://developers.tiktok.com/apps" } },
      { text: "Add the products Login Kit and Content Posting API." },
      { text: "In Login Kit, paste this as the Redirect URI:", copy: "redirect" },
      { text: "Add these scopes:", copy: "scopes" },
      { text: "Copy the Client key and Client secret and paste them below." },
    ],
    testing: "Use the app's Sandbox and add your TikTok account as a target user to test before review.",
    review: "Submit the app for review to go live. Posting straight to profiles (not drafts) also needs TikTok's Content Posting API audit.",
  },
};
