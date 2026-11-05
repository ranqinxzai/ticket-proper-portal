"use client";

import { History, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Hint } from "@/components/ui/hint";
import { interfaceApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import { cn } from "@/lib/utils";
import { type UiMode, useUi } from "./density-provider";

const OPTIONS: { value: UiMode; label: string; help: string; Icon: typeof History; badge?: string }[] = [
  {
    value: "classic",
    label: "Classic",
    help: "Classic — the previous layout: labelled side menu, page headers, full-page tickets. Saved to your account, so it follows you to other devices.",
    Icon: History,
  },
  {
    value: "modern",
    label: "Modern",
    help: "Modern — the workbench (the default): icon menu that opens on hover, page titles in the top bar, ⌘K search, tickets open beside the queue, softer colours. Same pages and data; you can switch to Classic any time. Saved to your account.",
    Icon: Sparkles,
  },
];

/** Segmented Classic / Modern control (profile menu, agent app only). Mirrors
 * DensityToggle: keyboard + screen-reader accessible, every option explains itself.
 * Switches instantly (and in this browser), then saves the choice to the account;
 * renders nothing when the organisation decides the interface (`uiLocked`). */
export function UiToggle({ className }: { className?: string }) {
  const { ui, setUi, uiLocked } = useUi();
  const { refreshUser } = useItsmAuth();
  if (uiLocked) return null;

  const choose = (value: UiMode) => {
    if (value === ui) return;
    setUi(value);
    interfaceApi
      .setPreference(value)
      .then(() => refreshUser())
      .catch(() =>
        toast.error("Couldn't save your interface choice to your account. It applies in this browser for now."),
      );
  };

  return (
    <div
      role="radiogroup"
      aria-label="Interface"
      className={cn("inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, help, Icon, badge }) => {
        const active = ui === value;
        return (
          <Hint key={value} label={help} side="left">
          <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(value)}
            className={cn(
              "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
            {badge ? (
              <span
                className={cn(
                  "rounded px-1 text-[10px] font-semibold uppercase tracking-wide",
                  active ? "bg-primary-foreground/20" : "bg-accent text-primary-ink",
                )}
              >
                {badge}
              </span>
            ) : null}
          </button>
          </Hint>
        );
      })}
    </div>
  );
}
