"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const PRESETS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#f59e0b", "#10b981", "#14b8a6", "#0ea5e9", "#3b82f6", "#64748b", "#111827",
];

/** Swatch presets + a hex input. Controlled. */
export function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value?: string | null;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const current = value || "#6366f1";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((hex) => {
          const active = current.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              disabled={disabled}
              aria-label={hex}
              aria-pressed={active}
              onClick={() => onChange(hex)}
              className={cn(
                "h-7 w-7 rounded-md border-2 transition-transform disabled:opacity-50",
                active ? "border-foreground scale-110" : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a custom color"
          disabled={disabled}
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border bg-transparent disabled:opacity-50"
        />
        <Input
          value={current}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 font-mono text-xs"
          aria-label="Hex color value"
        />
      </div>
    </div>
  );
}
