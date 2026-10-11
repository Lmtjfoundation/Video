"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, BookOpenText, Compass, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Field, Input } from "./ui";
import { LegalFooter } from "./legal-footer";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");
  const [setupCode, setSetupCode] = useState("");
  const [owner, setOwner] = useState<{ ownerNeeded: boolean; codeRequired: boolean } | null>(null);
  const [afterSignup, setAfterSignup] = useState("/?welcome=1");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = q.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
    const plan = q.get("plan");
    if (plan && ["creator", "pro", "unlimited"].includes(plan)) {
      setAfterSignup(`/plans?plan=${plan}&interval=${q.get("interval") === "year" ? "year" : "month"}`);
    }
    if (mode === "signup") api<{ ownerNeeded: boolean; codeRequired: boolean }>("/api/auth/setup-status").then(setOwner).catch(() => {});
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(mode === "login" ? "/api/auth/login" : "/api/auth/signup", { body: { email, password, name, setupCode: setupCode || undefined } });
      window.location.href = mode === "signup" ? afterSignup : next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between border-r border-white/[0.06] bg-ink-950/50 p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-mint-300 to-mint-500 shadow-glow">
            <Activity className="h-5 w-5 text-ink-950" strokeWidth={2.6} />
          </div>
          <span className="text-lg font-semibold text-white">Nexus Pulse</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tight text-white">
            Find the niche that pays. <span className="text-gradient">Post the stories that hold attention.</span>
          </h1>
          <ul className="mt-8 grid gap-4 text-[15px] text-white/70">
            <li className="flex gap-3"><Compass className="mt-0.5 h-5 w-5 shrink-0 text-mint-300" /> Niche research built on real revenue-per-view data, not guesses.</li>
            <li className="flex gap-3"><BookOpenText className="mt-0.5 h-5 w-5 shrink-0 text-mint-300" /> Faceless story scripts with hooks, scenes, visuals and a fact-check list.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-mint-300" /> Posts to six platforms on schedule, with rules checks that protect your accounts.</li>
          </ul>
        </div>
        <p className="text-xs text-white/35">Your social passwords are never stored. Accounts link through each platform's own sign-in.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="glass w-full max-w-sm p-7" noValidate>
          <h2 className="text-xl font-semibold text-white">{mode === "login" ? "Sign in" : owner?.ownerNeeded ? "Create the owner account" : "Create your account"}</h2>
          <p className="mt-1 text-sm text-white/50">{mode === "login" ? "Welcome back." : owner?.ownerNeeded ? "The first account becomes the admin, on the Unlimited plan." : "Free plan, no card needed."}</p>
          <div className="mt-6 grid gap-4">
            {mode === "signup" && (
              <Field label="Name">
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name or brand" />
              </Field>
            )}
            <Field label="Email">
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <Field label="Password" hint={mode === "signup" ? "10+ characters, include a number" : undefined}>
              <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {mode === "signup" && owner?.codeRequired && (
              <Field label="Owner setup code" hint="from your deployment settings">
                <Input id="setup-code" autoComplete="off" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} placeholder="e.g. NP-XXXX-XXXX" />
              </Field>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-400/25">{error}</p>}
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!email || !password}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </div>
          <p className="mt-5 text-center text-sm text-white/50">
            {mode === "login" ? (
              <>New here? <Link className="text-mint-300 hover:underline" href="/signup">Create an account</Link></>
            ) : (
              <>Already have an account? <Link className="text-mint-300 hover:underline" href="/login">Sign in</Link></>
            )}
          </p>
          {mode === "login" && (
            <p className="mt-3 text-center text-xs text-white/40">
              <Link href="/forgot" className="hover:text-white/70">Forgot your password?</Link>
            </p>
          )}
          {mode === "signup" && (
            <p className="mt-3 text-center text-xs leading-relaxed text-white/40">
              By creating an account you agree to the <Link href="/terms" className="underline hover:text-white/70">Terms</Link> and{" "}
              <Link href="/privacy" className="underline hover:text-white/70">Privacy Policy</Link>.
            </p>
          )}
          <p className="mt-3 text-center text-xs text-white/35"><Link href="/pricing" className="hover:text-white/60">See plans and pricing</Link></p>
          <LegalFooter className="mt-6 justify-center" />
        </form>
      </section>
    </div>
  );
}
