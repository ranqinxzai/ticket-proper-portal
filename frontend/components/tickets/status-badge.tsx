import { Hint } from "@/components/ui/hint";
import { statusTooltip } from "@/lib/itsm/help/status";
import { cn } from "@/lib/utils";
import type { StatusCategory } from "@/lib/itsm/types";

const CATEGORY_CLASS: Record<StatusCategory, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary-ink",
  done: "bg-success/15 text-success",
};

/** Status pill — colored dot from the configured status color + a text label
 * (never color-alone; WCAG 1.4.1). Themed via tokens, so works in both modes.
 *  Hover explains the status category; pass `hint` to override (the portal passes
 *  requestor-friendly wording) or `hint={false}` to turn it off. */
export function StatusBadge({
  name,
  category,
  color,
  className,
  hint,
  truncate,
}: {
  name: string;
  category: StatusCategory;
  color?: string | null;
  className?: string;
  hint?: string | false;
  /** One line, capped width, long names end in "…" (the Modern queue's Status column,
   *  2026-11-05c). The tooltip already carries the full name. */
  truncate?: boolean;
}) {
  const label = hint === false ? "" : (hint ?? statusTooltip(name, category));
  return (
    <Hint label={label}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
          CATEGORY_CLASS[category] ?? CATEGORY_CLASS.todo,
          truncate && "max-w-[6.5rem] whitespace-nowrap",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 rounded-full", truncate && "shrink-0")}
          style={{ backgroundColor: color || "currentColor" }}
        />
        {truncate ? <span className="min-w-0 truncate">{name}</span> : name}
      </span>
    </Hint>
  );
}
