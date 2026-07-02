import type { Priority, PriorityMatrix } from "./types";

/** The standard ITIL Priority Matrix — matrix[impact][urgency] -> priority.
 *  Mirrors the server default (apps.itsm_projects.models.default_priority_matrix);
 *  used as a fallback when a project hasn't stored one. */
export const DEFAULT_PRIORITY_MATRIX: PriorityMatrix = {
  critical: { high: "critical", medium: "critical", low: "high" },
  high: { high: "critical", medium: "high", low: "medium" },
  medium: { high: "high", medium: "medium", low: "low" },
  low: { high: "medium", medium: "low", low: "low" },
};

export const IMPACT_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const URGENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Derive Priority from Impact × Urgency using the project's matrix (or the default).
 *  Returns `null` when either input is blank or the matrix has no cell — the caller
 *  keeps the current priority in that case. Mirrors
 *  apps.itsm_tickets.services.priority.compute_priority. */
export function computePriority(
  matrix: PriorityMatrix | undefined | null,
  impact: string | undefined | null,
  urgency: string | undefined | null,
): Priority | null {
  if (!impact || !urgency) return null;
  const m = matrix || DEFAULT_PRIORITY_MATRIX;
  const row = m[impact];
  if (!row) return null;
  return (row[urgency] as Priority) || null;
}
