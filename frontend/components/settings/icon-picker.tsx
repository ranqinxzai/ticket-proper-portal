"use client";

import { cn } from "@/lib/utils";
import { ITSM_ICON_NAMES, ItsmIcon } from "@/lib/itsm/icon-map";

/** Grid picker over the registered ITSM icon names. Controlled. */
export function IconPicker({
  value,
  onChange,
  disabled,
}: {
  value?: string | null;
  onChange: (name: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ITSM_ICON_NAMES.map((name) => {
        const active = (value ?? "").toLowerCase() === name;
        return (
          <button
            key={name}
            type="button"
            disabled={disabled}
            aria-label={name}
            aria-pressed={active}
            onClick={() => onChange(name)}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-md border transition-colors disabled:opacity-50",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <ItsmIcon name={name} className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
