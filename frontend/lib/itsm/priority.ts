import type { Priority, PriorityMatrix } from "./types";

/** The standard ITIL Priority Matrix — matrix[impact][urgency] -> priority.
 *  Impact/Urgency keys stay descriptive; values are the P1–P4 priority codes.
 *  Mirrors the server default (apps.itsm_projects.models.default_priority_matrix);
 *  used as a fallback when a project hasn't stored one. */
export const DEFAULT_PRIORITY_MATRIX: PriorityMatrix = {
  critical: { high: "p1", medium: "p1", low: "p2" },
  high: { high: "p1", medium: "p2", low: "p3" },
  medium: { high: "p2", medium: "p3", low: "p4" },
  low: { high: "p3", medium: "p4", low: "p4" },
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

/** The P1–P4 priority scale (P1 = most severe). Single source of truth for the
 *  code order, the full "P1 – Critical" labels, and the compact "P1" chip labels;
 *  mirrors apps.itsm_tickets.models.Priority. */
export const PRIORITIES: Priority[] = ["p1", "p2", "p3", "p4"];

/** Full, descriptive labels (dropdowns, legends, email). */
export const PRIORITY_LABELS: Record<Priority, string> = {
  p1: "P1 – Critical",
  p2: "P2 – High",
  p3: "P3 – Medium",
  p4: "P4 – Low",
};

/** Compact labels for dense chips / table cells. */
export const PRIORITY_SHORT: Record<Priority, string> = {
  p1: "P1",
  p2: "P2",
  p3: "P3",
  p4: "P4",
};

/** Severity rank (0 = most severe) for sorting. */
export const PRIORITY_ORDER: Record<Priority, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = PRIORITIES.map((p) => ({
  value: p,
  label: PRIORITY_LABELS[p],
}));

/** Full label for a priority code, tolerant of unknown/legacy values. */
export function priorityLabel(value: string | null | undefined): string {
  if (!value) return "";
  return PRIORITY_LABELS[value as Priority] ?? value;
}

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
