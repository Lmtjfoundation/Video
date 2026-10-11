import Link from "next/link";
import { Contact, LegalShell, legalInfo } from "@/components/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data deletion · Nexus Pulse" };

export default async function DataDeletionPage() {
  const { email } = await legalInfo();
  return (
    <LegalShell
      title="Delete your data"
      intro="You can delete your Nexus Pulse account and everything stored with it yourself, at any time. Here's how, plus how to remove Nexus Pulse's access from each social platform."
    >
      <h2>Delete your account and all data</h2>
      <ul>
        <li><Link href="/login">Sign in</Link> and open <strong>Settings → Account</strong>.</li>
        <li>Press <strong>Delete my account…</strong>, type DELETE and enter your password.</li>
        <li>
          This immediately cancels any paid subscription and permanently deletes your posts, stories, uploads, rendered videos, connected-account tokens, logs and the
          account itself. It can&apos;t be undone.
        </li>
      </ul>

      <h2>Can&apos;t sign in?</h2>
      <p>
        Email <Contact email={email} /> from the email address on your account with the subject &quot;Delete my data&quot;. We&apos;ll confirm the request comes from
        you and complete the deletion within 30 days.
      </p>

      <h2>Disconnect a single platform</h2>
      <p>
        In <strong>Settings → Accounts</strong>, press Disconnect next to the platform. Nexus Pulse deletes the stored access token straight away and stops posting there.
      </p>

      <h2>Remove access on the platform side</h2>
      <ul>
        <li><strong>Facebook and Instagram (Meta):</strong> Facebook Settings &amp; privacy → Settings → Business integrations (or Apps and websites) → Nexus Pulse → Remove.</li>
        <li><strong>X:</strong> Settings and privacy → Security and account access → Apps and sessions → Connected apps → Nexus Pulse → Revoke app permissions.</li>
        <li><strong>YouTube (Google):</strong> open <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a> → Nexus Pulse → Remove access.</li>
        <li><strong>LinkedIn:</strong> Settings → Data privacy → Permitted services → Nexus Pulse → Remove.</li>
        <li><strong>TikTok:</strong> Settings and privacy → Security and permissions → Apps and services permissions → Nexus Pulse → Remove access.</li>
      </ul>
      <p>
        Posts that were already published stay on each platform until you delete them there. For more detail, see our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalShell>
  );
}
