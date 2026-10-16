import Link from "next/link";
import { Contact, LegalShell, legalInfo } from "@/components/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy Policy · Nexus Pulse" };

export default async function PrivacyPage() {
  const { name, email } = await legalInfo();
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`${name} operates Nexus Pulse (the "Service"). This policy explains what information we collect, why we collect it, who we share it with and the choices you have.`}
    >
      <h2>1. Information we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and password. Passwords are stored only as a salted scrypt hash, never in readable form.</li>
        <li><strong>Billing details:</strong> payments are handled by Stripe. We receive and keep your Stripe customer and subscription IDs, your plan, its status and renewal date. We never receive or store full card numbers.</li>
        <li><strong>Connected social accounts:</strong> when you link X, a Facebook Page, Instagram, LinkedIn, YouTube or TikTok, we receive access tokens (and refresh tokens where offered) plus basic account details such as the account ID, name or handle. Tokens are encrypted at rest with AES-256-GCM. If you use your personal Facebook profile, we store only the profile name (and the profile link, if you add it); nothing is posted to your profile by us — you post each item yourself.</li>
        <li><strong>Your content:</strong> niches, posts, scripts, video plans, uploaded images, video and audio, rendered videos, replies, schedules and settings.</li>
        <li><strong>Usage and logs:</strong> credit and post counts, a log of publishing attempts and errors, and timestamps. Our hosting provider also keeps standard server logs (such as IP address and browser type) for security and troubleshooting.</li>
        <li><strong>Cookies:</strong> we use one essential cookie to keep you signed in. We don&apos;t use advertising cookies or third-party analytics. If you install the app, your device may cache app files so it can open offline.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>to run the Service for you: generate drafts, render videos and publish content to the accounts you connect, on the schedule and approval settings you choose;</li>
        <li>to read comments and mentions on your connected accounts when you turn on the reply features, so you can review and send replies;</li>
        <li>to process payments, manage subscriptions and apply plan limits;</li>
        <li>to provide support, keep the Service secure, prevent abuse and meet legal obligations.</li>
      </ul>
      <p>
        We use the permissions you grant to a social platform only for these purposes. <strong>We don&apos;t sell your personal information</strong>, and we don&apos;t use
        it, or data from your connected accounts, for advertising.
      </p>

      <h2>3. Who we share it with</h2>
      <p>We share only what each provider needs to do its job for us:</p>
      <ul>
        <li><strong>Anthropic (Claude API)</strong> — prompts containing your niche, settings and drafts, to generate text.</li>
        <li><strong>ElevenLabs</strong> — script text, to create voiceovers, when voiceover is used.</li>
        <li><strong>Pixabay and Pexels</strong> — search keywords, to find stock footage. No personal information is sent.</li>
        <li><strong>Stripe</strong> — payment and subscription processing.</li>
        <li><strong>Our hosting and database providers</strong> — to store and serve the app and your data.</li>
        <li><strong>The social platforms you connect</strong> — the content you publish and the requests made on your behalf.</li>
        <li><strong>Legal and safety:</strong> when the law requires it, to protect rights and safety, or as part of a merger or sale of the business (with notice to you).</li>
      </ul>

      <h2>4. Google and YouTube</h2>
      <p>
        If you connect YouTube, Nexus Pulse uses YouTube API Services to upload the videos you choose to your channel. By connecting YouTube you agree to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>, and Google&apos;s handling of your data is described in
        the <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>. You can revoke Nexus Pulse&apos;s access at any time
        from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google account permissions</a>.
      </p>
      <p>
        Nexus Pulse&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including
        the Limited Use requirements.
      </p>

      <h2>5. Media links</h2>
      <p>
        So platforms such as Instagram and Facebook can fetch your images and videos when publishing, uploaded and rendered media files are served from unlisted,
        hard-to-guess links. Anyone who has such a link can open that file, so only upload material you intend to publish.
      </p>

      <h2>6. How long we keep it</h2>
      <p>
        We keep your information while your account is open. When you delete your account, we immediately cancel any subscription and delete your posts, stories,
        uploads, rendered videos, connected-account tokens, logs and the account itself from our systems. Stripe keeps its own payment records as the law requires.
        Content you already published stays on each platform until you delete it there. See the <Link href="/data-deletion">data deletion instructions</Link>.
      </p>

      <h2>7. Security</h2>
      <p>
        We use HTTPS, hashed passwords, encrypted tokens and admin-only access controls. No system is perfectly secure, so please use a strong, unique password.
      </p>

      <h2>8. Your choices and rights</h2>
      <ul>
        <li>Update your details and settings, or disconnect any social account, in Settings at any time.</li>
        <li>Delete your account and data yourself in Settings → Account → Delete account.</li>
        <li>Ask for a copy of your data, a correction or deletion by contacting <Contact email={email} />.</li>
      </ul>
      <p>
        Depending on where you live (for example California, the EEA or the UK), you may have rights to access, correct, delete or port your personal information and to
        object to or restrict some processing. We&apos;ll respond within the time the law requires and won&apos;t treat you differently for using these rights. We
        don&apos;t sell personal information or share it for cross-context behavioural advertising.
      </p>

      <h2>9. International processing</h2>
      <p>We and our providers process information in the United States and in other countries where those providers operate.</p>

      <h2>10. Children</h2>
      <p>The Service is for adults (18+) and isn&apos;t directed to children. If we learn that we collected information from a child, we&apos;ll delete it.</p>

      <h2>11. Changes</h2>
      <p>We may update this policy. If a change is material, we&apos;ll tell you by email or in the app before it takes effect.</p>

      <h2>12. Contact</h2>
      <p>
        Privacy questions or requests: <Contact email={email} />.
      </p>
    </LegalShell>
  );
}
