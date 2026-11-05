"use client";

import { Hint } from "@/components/ui/hint";
import type { AssetStateType } from "@/lib/itsm/assets-types";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

/** Status chip: colour dot + name. Hover explains the status's state type. */
export function AssetStatusBadge({
  name,
  color,
  stateType,
  className,
}: {
  name: string;
  color?: string | null;
  stateType?: AssetStateType | null;
  className?: string;
}) {
  const chip = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color || "#64748b" }}
        aria-hidden="true"
      />
      <span className="truncate">{name}</span>
    </span>
  );
  if (!stateType) return chip;
  return (
    <Hint label={ASSET_HELP.statusBadge(name, stateType)} wrap>
      {chip}
    </Hint>
  );
}

/** Small colour dot (for selects / lists that show a status by name). */
export function StatusDot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color || "#64748b" }}
      aria-hidden="true"
    />
  );
}
