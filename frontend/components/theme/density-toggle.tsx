"use client";

import { Rows3, Rows4 } from "lucide-react";

import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { type Density, useDensity } from "./density-provider";

const OPTIONS: { value: Density; label: string; help: string; Icon: typeof Rows3 }[] = [
  {
    value: "comfortable",
    label: "Comfortable",
    help: "Comfortable — roomier table rows, header and controls. Saved in this browser.",
    Icon: Rows3,
  },
  {
    value: "compact",
    label: "Compact",
    help: "Compact (default) fits more rows on screen — tighter rows, smaller header and controls. Saved in this browser.",
    Icon: Rows4,
  },
];

/** Segmented comfortable/compact control (profile menu, agent app only).
 * Keyboard + screen-reader accessible, styled like ThemeToggle. */
export function DensityToggle({ className }: { className?: string }) {
  const { density, setDensity } = useDensity();

  return (
    <div
      role="radiogroup"
      aria-label="Display density"
      className={cn("inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, help, Icon }) => {
        const active = density === value;
        return (
          <Hint key={value} label={help} side="left">
          <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setDensity(value)}
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
          </button>
          </Hint>
        );
      })}
    </div>
  );
}
