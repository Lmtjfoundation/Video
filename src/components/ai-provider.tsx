"use client";
import { useEffect, useState } from "react";
import { Brain, CheckCircle2, ExternalLink, KeyRound, RotateCcw } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { AI_PROVIDERS, AI_PROVIDER_IDS, type AiProvider } from "@/lib/ai-providers";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input } from "./ui";

type Choice = "builtin" | AiProvider;

/** Settings → AI: keep the app's built-in Claude (uses credits) or plug in your own AI service and key (no credits). */
export function AiProviderTab() {
  const { status, toast, refresh } = useApp();
  const own = status?.me.ownAi ?? null;
  const [choice, setChoice] = useState<Choice>(own?.provider ?? "builtin");
  const [model, setModel] = useState(own?.model ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "reset" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    setChoice(own?.provider ?? "builtin");
    setModel(own?.model ?? "");
  }, [own?.provider, own?.model]);

  const info = choice === "builtin" ? null : AI_PROVIDERS[choice];
  const sameProvider = !!own && own.provider === choice;

  async function test() {
    setBusy("test");
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/ai-provider", { method: "POST", body: {} });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (choice === "builtin") return reset();
    setBusy("save");
    setResult(null);
    try {
      await api("/api/ai-provider", { method: "PUT", body: { provider: choice, model: model || info!.defaultModel, apiKey: key } });
      setKey("");
      toast(`${info!.name} saved. Testing it now…`, "success");
      refresh();
      await test();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setResult(null);
    try {
      await api("/api/ai-provider", { method: "DELETE" });
      setKey("");
      toast("Back on the built-in AI", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5">
      <Card className="p-4 text-[13px] leading-relaxed text-white/65">
        <span className="font-medium text-white">You don't need a Claude account.</span> Ghost Post comes with its own AI built in, paid for by your plan's credits. If you'd rather use an AI you already pay for (ChatGPT, Gemini, Claude or any model on OpenRouter), connect it below with your own API key: everything you generate then runs on your key and <span className="text-mint-300">uses no credits</span>. Your key is stored encrypted and only ever sent to that provider.
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Brain className="h-4 w-4 text-mint-300" /> Which AI writes your content</span>}
          subtitle={own ? <span className="text-mint-300">Now using {AI_PROVIDERS[own.provider].name} · {own.model} · key {own.keyPreview}</span> : "Now using the built-in AI (Claude), included in your plan"}
        />
        <div className="grid gap-4 p-5">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="AI service">
            {(["builtin", ...AI_PROVIDER_IDS] as Choice[]).map((c) => {
              const name = c === "builtin" ? "Built-in (included)" : AI_PROVIDERS[c].name;
              const blurb = c === "builtin" ? "Claude, run by Ghost Post. Uses your plan's credits. Nothing to set up." : AI_PROVIDERS[c].blurb;
              const active = choice === c;
              return (
                <button
                  key={c}
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setChoice(c);
                    setResult(null);
                    setModel(c !== "builtin" && own?.provider === c ? own.model : "");
                  }}
                  className={cn(
                    "focus-ring grid gap-1 rounded-xl p-3 text-left ring-1 transition-colors",
                    active ? "bg-mint-400/[0.08] ring-mint-400/40" : "bg-white/[0.02] ring-white/[0.07] hover:bg-white/[0.04]",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    {name}
                    {(c === "builtin" ? !own : own?.provider === c) && <Badge tone="mint">in use</Badge>}
                  </span>
                  <span className="text-[12px] leading-snug text-white/55">{blurb}</span>
                </button>
              );
            })}
          </div>

          {info && (
            <div className="grid gap-3 rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]">
              <Field
                label={`${info.name} API key`}
                hint={
                  <a href={info.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-mint-300 hover:underline">
                    Get a key <ExternalLink className="h-3 w-3" />
                  </a>
                }
              >
                <Input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={sameProvider ? `•••••••• stored (${own!.keyPreview}), leave blank to keep` : info.keyPrefix ? `${info.keyPrefix}…` : "Paste your API key"}
                />
              </Field>
              <Field label="Model" hint={<span className="text-white/45">{info.modelHint}</span>}>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={info.defaultModel} />
              </Field>
              <p className="text-[12px] text-white/45">
                Usage is billed by {info.name.split(" (")[0]} to your account with them. A ChatGPT Plus or Gemini app subscription doesn't include API usage; the key comes from their developer site.
              </p>
            </div>
          )}

          {result && (
            <p role="status" className={cn("rounded-lg px-3 py-2 text-sm ring-1", result.ok ? "bg-mint-400/10 text-mint-200 ring-mint-400/25" : "bg-red-500/10 text-red-200 ring-red-400/25")}>
              {result.ok && <CheckCircle2 className="mr-1.5 inline h-4 w-4" />}
              {result.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {choice === "builtin" ? (
              <Button variant="primary" disabled={!own} loading={busy === "reset"} onClick={reset}>
                <RotateCcw className="h-4 w-4" /> {own ? "Switch back to built-in AI" : "Using built-in AI"}
              </Button>
            ) : (
              <>
                <Button variant="primary" loading={busy === "save"} disabled={!key && !sameProvider} onClick={save}>
                  <KeyRound className="h-4 w-4" /> Save and test
                </Button>
                {sameProvider && (
                  <Button variant="secondary" loading={busy === "test"} onClick={test}>Test connection</Button>
                )}
                {own && (
                  <Button variant="danger" loading={busy === "reset"} onClick={reset}>Remove my key</Button>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
