/** Status hover help (agent side). Portal-facing wording lives in help/portal.ts. */
import type { StatusCategory } from "@/lib/itsm/types";

export const STATUS_CATEGORY_HELP: Record<StatusCategory, string> = {
  todo: "To do — not started yet. Counts as open.",
  in_progress: "In progress — being worked on. Counts as open.",
  done: "Done — resolved or closed. No longer open; the resolution SLA has stopped.",
};

/** "Status: In Progress\nIn progress — being worked on. Counts as open." */
export function statusTooltip(name: string, category: StatusCategory): string {
  return `Status: ${name}\n${STATUS_CATEGORY_HELP[category] ?? ""}`.trim();
}
