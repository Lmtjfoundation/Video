import { body, fail, handle, ok } from "@/lib/http-api";
import { createPasswordReset, getAppSettings } from "@/lib/auth";
import { emailLayout, emailReady, sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const SENT = "If an account exists for that email, a reset link is on its way. It works for 1 hour — check your spam folder too.";

/** Public: emails a one-hour password reset link. Always answers the same way so accounts can't be discovered. */
export const POST = handle(async (req: Request) => {
  const { email } = await body<{ email?: string }>(req);
  const addr = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return fail("Enter the email address you signed up with.");
  if (!(await emailReady())) {
    const support = (await getAppSettings()).supportEmail;
    return fail(
      support
        ? `Password reset by email isn't switched on yet. Email ${support} and we'll reset it for you.`
        : "Password reset by email isn't switched on yet. Ask the app owner to reset your password.",
      503,
    );
  }
  const reset = await createPasswordReset(addr);
  if (reset) {
    const link = `${appOrigin(req)}/reset?token=${encodeURIComponent(reset.token)}`;
    try {
      await sendEmail({
        to: reset.user.email,
        subject: "Reset your Ghost Post password",
        text: `Hi ${reset.user.name},\n\nUse this link to choose a new password (it works once, for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email — your password stays the same.`,
        html: emailLayout({
          title: "Reset your password",
          lines: [`Hi ${reset.user.name},`, "Press the button to choose a new password. The link works once, for 1 hour."],
          button: { label: "Choose a new password", url: link },
          footer: "If you didn't ask for this, ignore this email — your password stays the same.",
        }),
      });
    } catch (e) {
      console.error("[nexus:email] password reset email failed:", (e as Error).message);
    }
  }
  return ok({ message: SENT });
});
