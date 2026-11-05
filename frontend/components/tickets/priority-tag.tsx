import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/itsm/types";
import { PRIORITY_LABELS, PRIORITY_SHORT } from "@/lib/itsm/priority";
import { PRIORITY_MEANING } from "@/lib/itsm/help/queue";

const PRIORITY: Record<Priority, { cls: string }> = {
  p1: { cls: "bg-destructive/15 text-destructive" },
  p2: { cls: "bg-warning/15 text-warning" },
  // Not `primary`: brand pink next to a red P1 would read as urgent.
  p3: { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  p4: { cls: "bg-muted text-muted-foreground" },
};

export function PriorityTag({ priority, className }: { priority: Priority; className?: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.p3;
  return (
    <span
      // Native title (not a Radix Hint): this chip repeats on every queue row.
      title={
        PRIORITY_MEANING[priority]
          ? `Priority ${PRIORITY_SHORT[priority]}: ${PRIORITY_MEANING[priority]}`
          : (PRIORITY_LABELS[priority] ?? priority)
      }
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        p.cls,
        className,
      )}
    >
      {PRIORITY_SHORT[priority] ?? priority}
    </span>
  );
}
