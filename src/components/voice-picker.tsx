"use client";
import { Select } from "@/components/ui";
import { useVoices } from "@/components/voice-tools";
import { cn } from "@/lib/utils";
import { STOCK_VOICES, type VoiceChoice } from "@/lib/voice-catalog";

/** Picks a voice: a free voice, the engine's own voice in a language, or one of My Voices (cloned or designed). */
export function VoicePicker({ value, onChange, languages, compact }: { value: VoiceChoice; onChange: (v: VoiceChoice) => void; languages?: Record<string, string>; compact?: boolean }) {
  const { data } = useVoices();
  const key = value.kind === "free" ? `free:${value.id}` : value.voiceId ? `mine:${value.voiceId}` : "engine:";
  const lang = value.kind === "engine" ? value.language : "en";
  return (
    <div className={cn("grid gap-2", !compact && "sm:grid-cols-[minmax(0,1fr)_170px]")}>
      <Select
        aria-label="Voice"
        value={key}
        onChange={(e) => {
          const [k, id] = e.target.value.split(":");
          if (k === "free") onChange({ kind: "free", id, speed: value.kind === "free" ? value.speed : 1 });
          else onChange({ kind: "engine", language: lang, voiceId: k === "mine" ? id : undefined });
        }}
      >
        <optgroup label="Free voices (English, run on Ghost Post)">
          {STOCK_VOICES.map((v) => <option key={v.id} value={`free:${v.id}`}>{v.name}: {v.description.toLowerCase()} ({v.accent})</option>)}
        </optgroup>
        <optgroup label="23 languages (engine)">
          <option value="engine:">Ghost Post engine voice</option>
          {data?.voices.map((v) => <option key={v.id} value={`mine:${v.id}`}>My voice: {v.name}</option>)}
        </optgroup>
      </Select>
      {value.kind === "engine" ? (
        <Select aria-label="Language" value={lang} onChange={(e) => onChange({ ...value, language: e.target.value })}>
          {Object.entries(languages ?? { en: "English" }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      ) : (
        <label className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-xs text-white/60">
          Speed
          <input type="range" min={0.7} max={1.3} step={0.05} value={value.speed ?? 1} onChange={(e) => onChange({ ...value, speed: Number(e.target.value) })} className="min-w-0 flex-1 accent-mint-400" aria-label="Speed" />
          <span className="w-9 tabular-nums">{(value.speed ?? 1).toFixed(2)}×</span>
        </label>
      )}
    </div>
  );
}

