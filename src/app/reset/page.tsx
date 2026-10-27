"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Field, Input } from "@/components/ui";
import { LegalFooter } from "@/components/legal-footer";

export default function ResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset", { body: { token, password } });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <Link href="/login" className="mb-8 flex items-center gap-3">
        <span className="grid grid-cols-1 h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500 shadow-glow">
          <Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} />
        </span>
        <span className="text-lg font-semibold text-white">Ghost Post</span>
      </Link>
      <div className="glass w-full max-w-sm p-7">
        {token === "" ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white">This link is incomplete</h1>
            <p className="mt-2 text-sm text-white/60">Open the full link from your email, or request a new one.</p>
            <Link href="/forgot" className="mt-6 inline-block text-sm text-mint-300 hover:underline">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className="text-xl font-semibold text-white">Choose a new password</h1>
            <p className="mt-1 text-sm text-white/50">You&apos;ll be signed out everywhere else and signed in here.</p>
            <div className="mt-6 grid grid-cols-1 gap-4">
              <Field label="New password" hint="10+ characters, include a number">
                <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Confirm new password">
                <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-400/25">
                  {error}
                  {/expired|already used/i.test(error) && (
                    <>
                      {" "}
                      <Link href="/forgot" className="underline">Request a new link</Link>
                    </>
                  )}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!token || !password || !confirm}>Save new password</Button>
            </div>
          </form>
        )}
      </div>
      <LegalFooter className="mt-10 w-full max-w-sm justify-center" />
    </div>
  );
}
