"use client";
import { useState } from "react";
import { CalendarClock, Check, ChevronDown, CircleDollarSign, Copy, ExternalLink, Pencil, Repeat2, Send, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { describeFlag } from "@/lib/compliance";
import { RepurposeDialog } from "./repurpose-dialog";
import type { Post, Settings } from "@/lib/types";
import { api, copyToClipboard, fmtDateTime } from "@/lib/client";
import { copyText, renderPost } from "@/lib/compose";
import { NICHES } from "@/lib/niches";
import { VIDEO_LENGTHS, VIDEO_STYLES } from "@/lib/video-spec";
import type { VideoPlan } from "@/lib/types";
import { localParts, addDays } from "@/lib/time";
import { useApp } from "@/lib/store";
import { cn, FORMAT_LABEL, PILLAR_LABEL, usd } from "@/lib/utils";
import { Badge, Button, Input, PlatformChip, ScoreRing, StatusBadge, Textarea } from "./ui";

export function PostCard({
  post,
  settings,
  onChange,
  compact,
}: {
  post: Post;
  settings: Settings;
  onChange: (p: Post | null) => void;
  compact?: boolean;
}) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [repurposing, setRepurposing] = useState(false);
  const tz = settings.timezone;
  const nowLocal = localParts(new Date(), tz);
  const initial = post.scheduledAt ? localParts(new Date(post.scheduledAt), tz) : { date: addDays(nowLocal.date, 1), time: settings.slots[post.platform]?.[0] ?? "09:00" };
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [draft, setDraft] = useState({ hook: post.hook, body: post.body, parts: post.parts.join("\n\n"), cta: post.cta ?? "", hashtags: post.hashtags.join(" "), imageUrl: post.imageUrl ?? "" });

  const blocked = post.safetyFlags.filter((f) => f.startsWith("block:"));
  const warns = post.safetyFlags.filter((f) => f.startsWith("warn:"));
  const offer = settings.offers.find((o) => o.id === post.offerId);
  const locked = post.status === "published" || post.status === "publishing";

  async function run<T>(key: string, fn: () => Promise<T>, success?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (success) toast(success, "success");
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: Record<string, unknown>, msg?: string) =>
    run("patch", async () => {
      const p = await api<Post>("/api/posts", { method: "PATCH", body: { id: post.id, ...body } });
      onChange(p);
      return p;
    }, msg);

  return (
    <div className={cn("glass group animate-rise overflow-hidden transition-colors hover:border-white/[0.12]", blocked.length && "border-red-400/25")}>
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <ScoreRing score={post.moneyScore} />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <PlatformChip platform={post.platform} />
            <StatusBadge status={post.status} />
            <Badge>{post.kind === "video" ? NICHES.find((n) => n.id === post.video?.niche)?.name ?? "Video" : PILLAR_LABEL[post.pillar]}</Badge>
            <Badge tone="violet">{post.kind === "video" ? "🎬 Video" : FORMAT_LABEL[post.format]}</Badge>
            {offer && <Badge tone="gold"><CircleDollarSign className="h-3 w-3" />{offer.name}</Badge>}
            {post.mature && <Badge tone="red">18+</Badge>}
            {post.mediaIds?.length ? <Badge tone="sky">{post.mediaIds.length} media</Badge> : null}
            {post.scheduledAt && <span className="ml-1 text-xs text-white/45">{fmtDateTime(post.scheduledAt, tz)}</span>}
          </div>
          <button className="w-full text-left" onClick={() => setOpen((v) => !v)}>
            <p className="text-[15px] font-semibold leading-snug text-white">{post.hook}</p>
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
            <span className="tabular-nums text-mint-300/90">
              est. {usd(post.revenue.low)}–{usd(post.revenue.high)}
            </span>
            <span className="hidden sm:inline">{post.revenue.basis}</span>
          </div>
        </div>
        {compact && (
          <button onClick={() => setOpen((v) => !v)} className="focus-ring rounded-lg p-1.5 text-white/40 hover:text-white" aria-label="Expand">
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-white/[0.06] px-4 pb-4 pt-4 sm:px-5">
          {editing ? (
            <div className="grid gap-3">
              <Input value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} placeholder="Hook" />
              <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Body" className="min-h-[120px]" />
              <Textarea value={draft.parts} onChange={(e) => setDraft({ ...draft, parts: e.target.value })} placeholder={post.kind === "video" ? "Narration — one block per scene, keep the [time] at the start" : "Thread parts / slides / script beats — separate with a blank line"} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} placeholder="Call to action" />
                <Input value={draft.hashtags} onChange={(e) => setDraft({ ...draft, hashtags: e.target.value })} placeholder="hashtags separated by spaces" />
              </div>
              {post.platform === "instagram" && (
                <Input value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="Public image URL (https://…) — required to auto-post to Instagram" />
              )}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === "patch"}
                  onClick={async () => {
                    const r = await patch({
                      hook: draft.hook,
                      body: draft.body,
                      parts: draft.parts.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean),
                      cta: draft.cta,
                      hashtags: draft.hashtags.split(/[\s,]+/).filter(Boolean),
                      imageUrl: draft.imageUrl,
                    }, "Saved");
                    if (r) setEditing(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : post.kind === "video" && post.video ? (
            <VideoPlanView plan={post.video} caption={renderPost(post, settings).join("\n")} />
          ) : (
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/60 p-4 font-sans text-[13.5px] leading-relaxed text-white/80 ring-1 ring-white/[0.05]">
              {copyText(post, settings)}
            </pre>
          )}

          {(blocked.length > 0 || warns.length > 0 || post.error) && (
            <div className="mt-3 space-y-1.5">
              {blocked.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-red-300">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Held to protect your account: {blocked.map(describeFlag).join(" ")}
                </p>
              )}
              {warns.length > 0 && <p className="text-xs text-gold-300/90">Review: {warns.map(describeFlag).join(" ")}</p>}
              {post.error && <p className="text-xs text-white/50">{post.error}</p>}
            </div>
          )}

          {post.status === "pending_review" && <p className="mt-3 rounded-lg bg-gold-400/[0.06] px-3 py-2 text-xs text-gold-300 ring-1 ring-gold-400/20">Waiting for admin approval before it can publish.</p>}
          {post.reviewNote && <p className={cn("mt-3 rounded-lg px-3 py-2 text-xs ring-1", post.status === "rejected" ? "bg-red-500/[0.06] text-red-200 ring-red-400/20" : "bg-white/[0.03] text-white/60 ring-white/10")}>Reviewer note: {post.reviewNote}{post.status === "rejected" ? " — edit it, then schedule again to resubmit." : ""}</p>}
          {post.moneyAngle && <p className="mt-3 text-xs text-white/50"><span className="text-gold-300">Money angle:</span> {post.moneyAngle}</p>}
          {!compact && post.scoreNotes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {post.scoreNotes.map((n) => (
                <span key={n} className="rounded-md bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/45 ring-1 ring-white/[0.06]">{n}</span>
              ))}
            </div>
          )}

          {scheduling && !locked && (
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
              <Input type="date" value={date} min={nowLocal.date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-auto" />
              <Button
                variant="primary"
                size="sm"
                loading={busy === "patch"}
                onClick={async () => {
                  const r = await patch({ date, time }, `Scheduled for ${date} ${time}`);
                  if (r) setScheduling(false);
                }}
              >
                Confirm
              </Button>
              <span className="text-[11px] text-white/40">{tz}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run("copy", async () => { await copyToClipboard(copyText(post, settings)); }, "Copied")}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            {!locked && (
              <>
                {post.kind !== "video" && (
                  <Button
                    size="sm"
                    variant="gold"
                    loading={busy === "money"}
                    onClick={() => run("money", async () => onChange(await api<Post>("/api/rewrite", { body: { id: post.id } })), "Rewritten for money potential")}
                  >
                    <CircleDollarSign className="h-3.5 w-3.5" /> Maximize money
                  </Button>
                )}
                <Button size="sm" onClick={() => setRepurposing(true)} title="Write native versions for other platforms">
                  <Repeat2 className="h-3.5 w-3.5" /> Repurpose
                </Button>
                <Button size="sm" onClick={() => setEditing((v) => !v)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" onClick={() => setScheduling((v) => !v)}>
                  <CalendarClock className="h-3.5 w-3.5" /> {post.scheduledAt ? "Reschedule" : "Schedule"}
                </Button>
                {post.status === "scheduled" && (
                  <Button size="sm" variant="ghost" onClick={() => patch({ unschedule: true }, "Moved back to drafts")}>
                    <Undo2 className="h-3.5 w-3.5" /> Unschedule
                  </Button>
                )}
                {post.status === "copy_ready" ? (
                  <Button size="sm" variant="primary" onClick={() => patch({ status: "published" }, "Marked as posted")}>
                    <Check className="h-3.5 w-3.5" /> I posted it
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    loading={busy === "publish"}
                    disabled={blocked.length > 0}
                    onClick={() =>
                      run("publish", async () => {
                        const r = await api<{ outcome: string; message: string; post: Post }>("/api/posts/publish", { body: { id: post.id } });
                        if (r.post) onChange(r.post);
                        toast(r.outcome === "published" ? "Published" : r.message, r.outcome === "published" ? "success" : "info");
                      })
                    }
                  >
                    <Send className="h-3.5 w-3.5" /> Post now
                  </Button>
                )}
              </>
            )}
            {post.externalUrl && (
              <a href={post.externalUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs text-mint-300 hover:bg-white/[0.05]">
                <ExternalLink className="h-3.5 w-3.5" /> View live
              </a>
            )}
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              loading={busy === "delete"}
              onClick={() => {
                if (!confirm("Delete this post?")) return;
                run("delete", async () => {
                  await api(`/api/posts?id=${post.id}`, { method: "DELETE" });
                  onChange(null);
                }, "Deleted");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      {repurposing && <RepurposeDialog postId={post.id} onClose={() => setRepurposing(false)} />}
    </div>
  );
}

/** Scene-by-scene production plan for a video post. */
function VideoPlanView({ plan, caption }: { plan: VideoPlan; caption: string }) {
  const words = plan.scenes.map((s) => s.narration).join(" ").split(/\s+/).filter(Boolean).length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="violet">{VIDEO_LENGTHS[plan.length]?.label ?? "Video"}</Badge>
        <Badge>{VIDEO_STYLES[plan.style]}</Badge>
        <span className="text-xs text-white/45">{plan.scenes.length} scenes · {words} words · ≈{Math.round(words / 2.6)} s at a natural pace</span>
      </div>
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div>
          <p className="font-medium text-white">Title options</p>
          <ol className="mt-1 list-decimal pl-5 text-white/75">{plan.titles.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
        <div>
          <p className="font-medium text-white">Thumbnail {plan.thumbnail?.text && <Badge tone="gold">{plan.thumbnail.text}</Badge>}</p>
          <p className="mt-1 text-white/55">{plan.thumbnail?.prompt}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-white/[0.06]">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wider text-white/40">
            <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Narration</th><th className="px-3 py-2">On screen</th><th className="px-3 py-2">Visual & edit</th></tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {plan.scenes.map((s, i) => (
              <tr key={i} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-white/45">{s.time}</td>
                <td className="px-3 py-2 text-white/85">{s.narration}</td>
                <td className="px-3 py-2 font-semibold text-white">{s.onScreen}</td>
                <td className="px-3 py-2 text-white/70">{s.visual}<p className="text-white/40">{s.motion}{s.sfx ? ` · 🔊 ${s.sfx}` : ""}</p></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 text-sm text-white/75 md:grid-cols-2">
        <p><span className="font-medium text-white">Voice.</span> {plan.voice}</p>
        <p><span className="font-medium text-white">Music & sound.</span> {plan.music}</p>
      </div>
      {plan.loopLine && <p className="text-sm text-white/75"><span className="font-medium text-white">Loop line.</span> {plan.loopLine}</p>}
      {plan.factCheck.length > 0 && (
        <div className="rounded-xl bg-gold-400/[0.06] p-3 text-sm text-gold-100/90 ring-1 ring-gold-400/25">
          <p className="font-medium text-gold-200">Verify before posting</p>
          <ul className="mt-1 list-disc pl-5">{plan.factCheck.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      <div>
        <p className="mb-1 text-sm font-medium text-white">Caption</p>
        <pre className="whitespace-pre-wrap break-words rounded-xl bg-ink-950/60 p-3 font-sans text-[13px] text-white/80 ring-1 ring-white/[0.05]">{caption}</pre>
      </div>
    </div>
  );
}
