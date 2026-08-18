import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/itsm/types";
import { PRIORITY_LABELS, PRIORITY_SHORT } from "@/lib/itsm/priority";

const PRIORITY: Record<Priority, { cls: string }> = {
  p1: { cls: "bg-destructive/15 text-destructive" },
  p2: { cls: "bg-warning/15 text-warning" },
  p3: { cls: "bg-primary/10 text-primary" },
  p4: { cls: "bg-muted text-muted-foreground" },
};

export function PriorityTag({ priority, className }: { priority: Priority; className?: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.p3;
  return (
    <span
      title={PRIORITY_LABELS[priority] ?? priority}
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
