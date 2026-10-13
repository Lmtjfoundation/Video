"use client";
import { useState } from "react";
import { BookOpenText } from "lucide-react";
import { api } from "@/lib/client";
import { useApp } from "@/lib/store";
import { Button } from "./ui";

/** Adds hand-written, fact-checked starter drafts — works without AI credits. */
export function StarterButton({
  onDone,
  variant = "secondary",
  size = "sm",
  label = "Add ready-made posts",
  goTo,
}: {
  onDone?: () => void;
  variant?: "primary" | "secondary" | "gold" | "ghost";
  size?: "sm" | "md" | "lg";
  label?: string;
  goTo?: string;
}) {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ created: number }>("/api/starter", { body: {} });
          toast(
            r.created
              ? `Added ${r.created} ready-made drafts — true stories, no credits used.`
              : "You already have all the ready-made posts for your platforms.",
            "success",
          );
          onDone?.();
          refresh();
          if (goTo) window.location.href = goTo;
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <BookOpenText className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}
