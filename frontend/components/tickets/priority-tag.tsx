import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/itsm/types";

const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-destructive/15 text-destructive" },
  high: { label: "High", cls: "bg-warning/15 text-warning" },
  medium: { label: "Medium", cls: "bg-primary/10 text-primary" },
  low: { label: "Low", cls: "bg-muted text-muted-foreground" },
};

export function PriorityTag({ priority, className }: { priority: Priority; className?: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.medium;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        p.cls,
        className,
      )}
    >
      {p.label}
    </span>
  );
}
