"use client";
import { useState } from "react";
import Link from "next/link";
import { Activity, MailCheck } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Field, Input } from "@/components/ui";
import { LegalFooter } from "@/components/legal-footer";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/api/auth/forgot", { body: { email } });
      setSent(r.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <Link href="/login" className="mb-8 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500 shadow-glow">
          <Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} />
        </span>
        <span className="text-lg font-semibold text-white">Ghost Post</span>
      </Link>
      <div className="glass w-full max-w-sm p-7">
        {sent ? (
          <div className="text-center">
            <MailCheck className="mx-auto h-10 w-10 text-mint-300" />
            <h1 className="mt-4 text-xl font-semibold text-white">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{sent}</p>
            <Link href="/login" className="mt-6 inline-block text-sm text-mint-300 hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className="text-xl font-semibold text-white">Forgot your password?</h1>
            <p className="mt-1 text-sm text-white/50">Enter your account email and we&apos;ll send you a link to choose a new one.</p>
            <div className="mt-6 grid gap-4">
              <Field label="Email">
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-400/25">{error}</p>}
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!email}>Send reset link</Button>
            </div>
            <p className="mt-5 text-center text-sm text-white/50">
              Remembered it? <Link className="text-mint-300 hover:underline" href="/login">Sign in</Link>
            </p>
          </form>
        )}
      </div>
      <LegalFooter className="mt-10 w-full max-w-sm justify-center" />
    </div>
  );
}
