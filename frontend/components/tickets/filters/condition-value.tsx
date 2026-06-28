"use client";

import { X } from "lucide-react";

import type {
  FilterCondition,
  FilterFieldMeta,
  FilterFieldOption,
  FilterValue,
  UserRef,
} from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { UserSearchCombobox } from "@/components/settings/user-search-combobox";
import { MULTI_OPS, VALUELESS_OPS, type LabelResolver } from "./filter-utils";

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Props = {
  field: FilterFieldMeta;
  condition: FilterCondition;
  options: FilterFieldOption[];
  labelFor: LabelResolver;
  registerUserLabel: (id: string, label: string) => void;
  onChange: (value: FilterValue) => void;
};

function asArray(v: FilterValue | undefined): string[] {
  if (Array.isArray(v)) return v.map(String);
  return v === undefined || v === null || v === "" ? [] : [String(v)];
}

export function ConditionValue({
  field, condition, options, labelFor, registerUserLabel, onChange,
}: Props) {
  const { op } = condition;
  if (VALUELESS_OPS.has(op)) return null;

  const multi = MULTI_OPS.has(op) || field.type === "multiselect";

  // ── date ────────────────────────────────────────────────────────────────
  if (field.type === "date") {
    if (op === "between") {
      const pair = asArray(condition.value);
      return (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From" value={pair[0] ?? ""}
            onChange={(e) => onChange([e.target.value, pair[1] ?? ""])} className="h-9" />
          <span className="text-sm text-muted-foreground">–</span>
          <Input type="date" aria-label="To" value={pair[1] ?? ""}
            onChange={(e) => onChange([pair[0] ?? "", e.target.value])} className="h-9" />
        </div>
      );
    }
    return (
      <Input type="date" aria-label={field.label} value={(condition.value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)} className="h-9" />
    );
  }

  // ── number ──────────────────────────────────────────────────────────────
  if (field.type === "number") {
    if (op === "between") {
      const pair = asArray(condition.value);
      return (
        <div className="flex items-center gap-2">
          <Input type="number" aria-label="Min" value={pair[0] ?? ""}
            onChange={(e) => onChange([e.target.value, pair[1] ?? ""])} className="h-9" />
          <span className="text-sm text-muted-foreground">–</span>
          <Input type="number" aria-label="Max" value={pair[1] ?? ""}
            onChange={(e) => onChange([pair[0] ?? "", e.target.value])} className="h-9" />
        </div>
      );
    }
    return (
      <Input type="number" aria-label={field.label} value={(condition.value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)} className="h-9" />
    );
  }

  // ── text ──────────────────────────────────────────────────────────────────
  if (field.type === "text") {
    return (
      <Input aria-label={field.label} value={(condition.value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)} placeholder="Enter text…" className="h-9" />
    );
  }

  // ── user ──────────────────────────────────────────────────────────────────
  if (field.type === "user") {
    const selected = asArray(condition.value);
    const meSelected = selected.includes("me");
    const onPick = (u: UserRef) => {
      const id = String(u.id);
      registerUserLabel(id, u.full_name || u.username);
      if (multi) onChange(Array.from(new Set([...selected, id])));
      else onChange(id);
    };
    const toggleMe = () =>
      multi
        ? onChange(meSelected ? selected.filter((s) => s !== "me") : [...selected, "me"])
        : onChange(meSelected ? "" : "me");
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={meSelected} onCheckedChange={toggleMe} aria-label="Current user (me)" />
          Current user (me)
        </label>
        <UserSearchCombobox value={null} placeholder="Add a person…" onSelect={onPick} />
        {multi && selected.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selected.map((id) => (
              <span key={id}
                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                {id === "me" ? "Me" : labelFor(field.key, id) ?? id}
                <button type="button" aria-label="Remove" className="hover:text-destructive"
                  onClick={() => onChange(selected.filter((s) => s !== id))}>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {!multi && selected.length > 0 && !meSelected && (
          <p className="text-xs text-muted-foreground">
            Selected: {labelFor(field.key, selected[0]) ?? selected[0]}
          </p>
        )}
      </div>
    );
  }

  // ── select / choice / multiselect (option list) ───────────────────────────
  if (multi) {
    const selected = asArray(condition.value);
    const toggle = (val: string) =>
      onChange(selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val]);
    if (options.length === 0) {
      return <p className="text-sm text-muted-foreground">No options available.</p>;
    }
    return (
      <ul className="max-h-64 space-y-0.5 overflow-auto">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
              <Checkbox checked={selected.includes(o.value)}
                onCheckedChange={() => toggle(o.value)} aria-label={o.label} />
              {o.color ? (
                <span aria-hidden="true" className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: o.color }} />
              ) : null}
              <span className="truncate">{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
    );
  }

  // single-value select (eq / neq)
  return (
    <select className={cn(selectCls)} aria-label={field.label}
      value={(condition.value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>Select…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
