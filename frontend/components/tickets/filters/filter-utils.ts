/** Pure helpers for the ticket filter engine: operator metadata, condition
 *  completeness, spec (de)serialization, and chip-summary text. No React. */

import type {
  FilterCondition,
  FilterFieldMeta,
  FilterMatch,
  FilterOperator,
  FilterSpec,
} from "@/lib/itsm/types";

/** Fields shown as chips up-front in the quick-filter bar (JIRA-style). */
export const DEFAULT_FIELD_KEYS = ["status", "assignee", "priority", "ticket_type", "created_at"];

/** The system view a queue resolves to when neither the user nor the project has
 *  chosen a default. Mirrors the backend `PRODUCT_DEFAULT_VIEW_KEY`. */
export const PRODUCT_DEFAULT_VIEW_KEY = "open";

/** Operators that take no value — the value input is hidden for these. */
export const VALUELESS_OPS = new Set<FilterOperator>([
  "is_empty", "is_not_empty", "is_true", "is_false",
  "today", "yesterday", "last_7_days", "last_30_days", "this_week", "this_month",
  "overdue", "due_today",
]);

/** Operators whose value is a list. */
export const MULTI_OPS = new Set<FilterOperator>(["in", "not_in"]);

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  not_in: "is none of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  contains: "contains",
  not_contains: "does not contain",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  between: "between",
  on: "on",
  before: "before",
  after: "after",
  today: "today",
  yesterday: "yesterday",
  last_7_days: "in last 7 days",
  last_30_days: "in last 30 days",
  this_week: "this week",
  this_month: "this month",
  overdue: "overdue",
  due_today: "due today",
  is_true: "is checked",
  is_false: "is not checked",
};

export function operatorLabel(op: FilterOperator): string {
  return OPERATOR_LABELS[op] ?? op;
}

/** A condition is "complete" (worth sending to the API) when its operator needs
 *  no value, or its value is present and well-formed. */
export function isConditionComplete(c: FilterCondition): boolean {
  if (VALUELESS_OPS.has(c.op)) return true;
  const v = c.value;
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) {
    if (c.op === "between") return v.length === 2 && v.every((x) => x !== "" && x != null);
    return v.length > 0;
  }
  return true;
}

/** Build a normalized spec from the bar state (drops incomplete conditions). */
export function buildSpec(conditions: FilterCondition[], match: FilterMatch): FilterSpec {
  return { match, conditions: conditions.filter(isConditionComplete) };
}

/** JSON string for the `?q=` param / API arg — undefined when nothing is set. */
export function serializeSpec(conditions: FilterCondition[], match: FilterMatch): string | undefined {
  const spec = buildSpec(conditions, match);
  if (spec.conditions.length === 0) return undefined;
  return JSON.stringify(spec);
}

/** Parse a `?q=` JSON string back to conditions (tolerant of garbage). */
export function parseSpec(raw: string | null | undefined): { match: FilterMatch; conditions: FilterCondition[] } {
  if (!raw) return { match: "all", conditions: [] };
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && Array.isArray(obj.conditions)) {
      const conditions = obj.conditions.filter(
        (c: unknown): c is FilterCondition =>
          !!c && typeof c === "object" && typeof (c as FilterCondition).field === "string"
          && typeof (c as FilterCondition).op === "string",
      );
      return { match: obj.match === "any" ? "any" : "all", conditions };
    }
  } catch {
    /* malformed — fall through */
  }
  return { match: "all", conditions: [] };
}

/** A label resolver maps (fieldKey, rawValue) → human label (e.g. status id → name). */
export type LabelResolver = (fieldKey: string, value: string) => string | undefined;

function valueLabel(field: FilterFieldMeta, raw: unknown, resolve?: LabelResolver): string {
  const s = String(raw);
  if (raw === "me") return "me";
  return resolve?.(field.key, s) ?? s;
}

/** Short text shown on a chip after the field label, e.g. "is any of To Do, Open +2". */
export function conditionSummary(
  c: FilterCondition,
  field: FilterFieldMeta,
  resolve?: LabelResolver,
): string {
  if (VALUELESS_OPS.has(c.op)) return operatorLabel(c.op);
  const v = c.value;
  if (c.op === "between" && Array.isArray(v)) {
    return `${operatorLabel(c.op)} ${v[0] ?? ""} – ${v[1] ?? ""}`;
  }
  if (Array.isArray(v)) {
    const labels = v.map((x) => valueLabel(field, x, resolve));
    const head = labels.slice(0, 2).join(", ");
    const extra = labels.length > 2 ? ` +${labels.length - 2}` : "";
    return `${operatorLabel(c.op)} ${head}${extra}`;
  }
  return `${operatorLabel(c.op)} ${valueLabel(field, v, resolve)}`;
}
