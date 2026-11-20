"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PreviewItem = {
  n: number;
  mime: string;
  label: string;
  at: string;
};

const src = (key: string, n: number) =>
  `/api/previews/${encodeURIComponent(key)}/${n}`;

/** One piece: a clip plays (muted and looping in the tray, with sound and controls full screen), a picture shows. */
function Piece({
  k,
  item,
  full,
  className,
}: {
  k: string;
  item: PreviewItem;
  full?: boolean;
  className?: string;
}) {
  if (item.mime.startsWith("video/"))
    return (
      <video
        key={`${k}-${item.n}`}
        src={src(k, item.n)}
        className={className}
        autoPlay
        loop
        playsInline
        muted={!full}
        controls={full}
        preload="auto"
      />
    );
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      key={`${k}-${item.n}`}
      src={src(k, item.n)}
      alt={item.label || "Preview"}
      className={className}
    />
  );
}

/**
 * Watch a video being made: the newest finished piece (a clip, a picture, a rendered scene) plays in the jobs tray
 * as soon as it's ready, earlier ones sit underneath, and any of them opens full screen. New pieces take over the
 * player as they arrive unless the person has picked one to look at.
 */
export function LivePreview({
  k,
  items,
  live,
}: {
  k: string;
  items: PreviewItem[];
  live: boolean;
}) {
  const latest = items.at(-1)!;
  const [picked, setPicked] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const current = items.find((i) => i.n === picked) ?? latest;
  const index = items.indexOf(current);

  // A picked piece that has since been dropped (only the latest few are kept) falls back to the newest.
  useEffect(() => {
    if (picked !== null && !items.some((i) => i.n === picked)) setPicked(null);
  }, [items, picked]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
      if (e.key === "ArrowLeft" && index > 0) setPicked(items[index - 1].n);
      if (e.key === "ArrowRight" && index < items.length - 1)
        setPicked(items[index + 1].n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, index, items]);

  const name =
    current.label || (current.mime.startsWith("video/") ? "Clip" : "Picture");
  // "Scene 3 of 7" already says where it is; other labels get the position among the pieces kept.
  const caption = / of \d/.test(name)
    ? name
    : `${name} · ${index + 1}/${items.length}`;

  return (
    <div className="mt-2">
      <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-black">
        <Piece
          k={k}
          item={current}
          className="mx-auto max-h-56 w-full object-contain"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
          {live && current.n === latest.n && (
            <span className="flex items-center gap-1 rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Live
            </span>
          )}
          <span className="truncate text-[11px] font-medium text-white/85">
            {caption}
          </span>
        </div>
        <button
          onClick={() => setFull(true)}
          className="focus-ring absolute bottom-1.5 right-1.5 rounded-lg bg-black/60 p-1.5 text-white/80 hover:text-white"
          aria-label="Watch full screen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {items.length > 1 && (
        <div
          className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5"
          role="list"
          aria-label="Pieces made so far"
        >
          {items.map((i) => (
            <button
              key={i.n}
              role="listitem"
              onClick={() => setPicked(i.n === latest.n ? null : i.n)}
              className={cn(
                "focus-ring relative h-12 w-9 shrink-0 overflow-hidden rounded-md border bg-black",
                i.n === current.n
                  ? "border-gold-300"
                  : "border-white/10 opacity-70 hover:opacity-100",
              )}
              aria-label={`${i.label || "Piece"} ${items.indexOf(i) + 1}`}
              aria-current={i.n === current.n}
            >
              {i.mime.startsWith("video/") ? (
                <video
                  src={`${src(k, i.n)}#t=0.5`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src(k, i.n)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {full &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Live preview"
          >
            <div className="flex items-center justify-between px-4 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
              <p className="text-sm font-medium text-white">
                {live && current.n === latest.n && (
                  <span className="mr-2 rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    Live
                  </span>
                )}
                {caption}
              </p>
              <button
                onClick={() => setFull(false)}
                className="focus-ring rounded-lg p-2 text-white/70 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              <button
                onClick={() => setPicked(items[index - 1].n)}
                disabled={index <= 0}
                className="focus-ring absolute left-2 z-10 rounded-full bg-white/10 p-2 text-white disabled:opacity-20"
                aria-label="Previous piece"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <Piece
                k={k}
                item={current}
                full
                className="max-h-full max-w-full rounded-lg object-contain"
              />
              <button
                onClick={() =>
                  setPicked(
                    index + 1 === items.length - 1 ? null : items[index + 1].n,
                  )
                }
                disabled={index >= items.length - 1}
                className="focus-ring absolute right-2 z-10 rounded-full bg-white/10 p-2 text-white disabled:opacity-20"
                aria-label="Next piece"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>,
          // On the page itself: inside the tray (which blurs what's behind it) a fixed overlay can't cover the screen.
          document.body,
        )}
    </div>
  );
}
