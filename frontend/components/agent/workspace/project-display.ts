import type { Project } from "@/lib/itsm/types";

/** Tab/menu label for a project: ITIL types get canonical names, custom keeps its own. */
export function projectLabel(p: Project): string {
  if (p.project_type === "incident") return "Incident";
  if (p.project_type === "service_request") return "Request";
  return p.name;
}

/** Stored icon name for a project, falling back to a type-appropriate lucide name. */
export function projectIconName(p: Project): string {
  if (p.icon) return p.icon;
  if (p.project_type === "incident") return "alert-triangle";
  if (p.project_type === "service_request") return "inbox";
  return "folder-kanban";
}
