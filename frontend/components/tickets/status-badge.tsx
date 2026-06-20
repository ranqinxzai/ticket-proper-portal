import { cn } from "@/lib/utils";
import type { StatusCategory } from "@/lib/itsm/types";

const CATEGORY_CLASS: Record<StatusCategory, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary",
  done: "bg-success/15 text-success",
};

/** Status pill — colored dot from the configured status color + a text label
 * (never color-alone; WCAG 1.4.1). Themed via tokens, so works in both modes. */
export function StatusBadge({
  name,
  category,
  color,
  className,
}: {
  name: string;
  category: StatusCategory;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        CATEGORY_CLASS[category] ?? CATEGORY_CLASS.todo,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color || "currentColor" }}
      />
      {name}
    </span>
  );
}
