import Link from "next/link";
import { Contact, LegalShell, legalInfo } from "@/components/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms of Service · Nexus Pulse" };

export default async function TermsPage() {
  const { name, email, law } = await legalInfo();
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These Terms of Service ("Terms") govern your use of Nexus Pulse (the "Service"), operated by ${name} ("we", "us"). By creating an account or using the Service you agree to these Terms and to our Privacy Policy.`}
    >
      <h2>1. Your account</h2>
      <ul>
        <li>You must be at least 18 years old and able to form a binding contract to use the Service.</li>
        <li>Give accurate sign-up information and keep your password secret. You&apos;re responsible for everything done under your account.</li>
        <li>We may refuse, suspend or close accounts that break these Terms or put the Service, other users or the connected platforms at risk.</li>
      </ul>

      <h2>2. What the Service does</h2>
      <p>
        Nexus Pulse helps you research content niches, draft posts and video scripts with AI, render short videos, and schedule and publish them to social accounts you
        connect (X, Facebook Pages, Instagram, LinkedIn, YouTube and TikTok). Content is published only to accounts you connect, following the schedule and approval
        settings you choose. You can pause all posting at any time.
      </p>

      <h2>3. Plans, billing and renewal</h2>
      <ul>
        <li>The Free plan costs nothing. Paid plans and their prices, credits and posting limits are listed on the <Link href="/pricing">Pricing page</Link>. Prices are in US dollars and exclude any applicable taxes unless stated at checkout.</li>
        <li>Payments are processed by Stripe. We never see or store your full card number.</li>
        <li><strong>Paid plans renew automatically</strong> at the end of each monthly or yearly billing period, at the price then in effect, until you cancel. Your payment method is charged at the start of each period.</li>
        <li><strong>Cancel any time</strong> in the app under Plans &amp; Billing → Manage billing. Cancellation takes effect at the end of the current billing period: you keep your paid plan until then, and the account then moves to the Free plan.</li>
        <li>Upgrades and downgrades are made in the same billing portal. Stripe prorates the difference for the rest of the current period.</li>
        <li>We&apos;ll give you at least 30 days&apos; notice by email before a price change applies to your subscription.</li>
        <li>If a renewal payment fails, Stripe retries it. If it still can&apos;t be collected, your subscription may be cancelled and your account moved to the Free plan.</li>
        <li>AI credits and post allowances reset on the 1st of each month. Unused credits don&apos;t roll over and have no cash value.</li>
      </ul>

      <h2 id="refunds">4. Refunds</h2>
      <p>
        Because AI processing costs are incurred as soon as you use the Service, subscription payments are non-refundable, except: (a) where the law requires a refund;
        (b) if you were charged after you cancelled, or charged twice, because of an error — tell us within 30 days of the charge and we&apos;ll refund it in full. We may
        also grant other refunds or account credits at our discretion. To ask for a refund, contact <Contact email={email} /> from the email address on your account.
      </p>

      <h2>5. Your content and connected accounts</h2>
      <ul>
        <li>You own the content you create or upload. You give us a limited licence to host, process, copy, transmit and display it only as needed to run the Service for you — for example sending prompts to our AI providers, rendering videos and publishing to the accounts you connect.</li>
        <li>You&apos;re responsible for what is published from your accounts through the Service, including having the rights to any material you use and following the law and each platform&apos;s rules.</li>
        <li>Publishing depends on each platform&apos;s API, review status, permissions and limits. Platforms can change, restrict, delay or reject posts, and some limit what unreviewed apps can publish (for example, private or draft-only uploads). We aren&apos;t responsible for actions taken by those platforms.</li>
        <li>Nexus Pulse is independent and is not affiliated with, endorsed or sponsored by X, Meta, LinkedIn, Google/YouTube or TikTok.</li>
      </ul>

      <h2>6. AI-generated content</h2>
      <p>
        Drafts, scripts, voiceovers and other outputs are produced with third-party AI models. They can be inaccurate, incomplete or similar to material created for
        others. Review everything before it&apos;s published, and label AI-generated or synthetic media wherever a platform&apos;s rules or the law require it. Don&apos;t
        rely on outputs as legal, medical, financial or other professional advice.
      </p>

      <h2>7. No earnings guarantee</h2>
      <p>
        Revenue estimates, money scores, niche rankings and similar figures in the app are estimates based on general market information and assumptions. They are not a
        promise or guarantee of income, views, followers or any other result. Your results depend on many factors outside our control.
      </p>

      <h2>8. Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>break any law or anyone else&apos;s rights, including copyright, trademark, privacy and publicity rights;</li>
        <li>send spam, run fake engagement, manipulate platforms or evade their limits or enforcement;</li>
        <li>impersonate people or organisations, or publish deceptive, defamatory, harassing or hateful content;</li>
        <li>publish sexually explicit content, any content that sexualises minors, or intimate images shared without consent;</li>
        <li>make misleading health, financial or earnings claims, or promote anything illegal or dangerous;</li>
        <li>access other people&apos;s accounts, probe or disrupt the Service, upload malware, or resell the Service without our written permission.</li>
      </ul>
      <p>
        The optional mature mode is limited to non-explicit content on X, must follow X&apos;s rules (including marking sensitive media), and is for adults only. We may
        remove content, pause publishing or suspend accounts that break these rules.
      </p>

      <h2>9. Changes and availability</h2>
      <p>
        We work to keep the Service available and improving, but we don&apos;t guarantee it will be uninterrupted or error-free. We may add, change or remove features. If
        a change materially reduces what a paid plan includes, we&apos;ll tell you in advance.
      </p>

      <h2>10. Ending your account</h2>
      <p>
        You can delete your account at any time in Settings → Account → Delete account. Deleting it cancels your subscription and permanently deletes your data as
        described in our <Link href="/privacy">Privacy Policy</Link> and <Link href="/data-deletion">data deletion instructions</Link>. We may suspend or close your
        account if you break these Terms; where reasonable we&apos;ll tell you first.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        To the fullest extent allowed by law, the Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, whether express or
        implied, including warranties of merchantability, fitness for a particular purpose and non-infringement.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the fullest extent allowed by law, we won&apos;t be liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits,
        revenue, data or goodwill. Our total liability for any claim relating to the Service is limited to the amount you paid us in the 12 months before the event
        giving rise to the claim.
      </p>

      <h2>13. Indemnity</h2>
      <p>
        You agree to defend and indemnify us against claims, losses and costs (including reasonable legal fees) arising from your content, your use of the Service or
        your breach of these Terms.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These Terms are governed by the laws of {law}, without regard to conflict-of-law rules. Disputes will be handled by the courts located there, unless the law
        where you live gives you the right to bring a claim locally.
      </p>

      <h2>15. Changes to these Terms</h2>
      <p>
        We may update these Terms. If a change is material, we&apos;ll let you know by email or in the app before it takes effect. Continuing to use the Service after
        that means you accept the updated Terms.
      </p>

      <h2>16. Contact</h2>
      <p>
        Questions about these Terms: <Contact email={email} />.
      </p>
    </LegalShell>
  );
}
