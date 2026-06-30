"use client";

/**
 * Shared rendering for org-defined custom user attributes — used by the
 * create-user dialog, the edit-attributes dialog, and the roster table cell.
 * Every component here is module-top-level (React focus stability — see
 * QA_CHECKLIST "React Component Stability").
 */

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserAttributeDefinition } from "@/lib/itsm/types";

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

type AttrValues = Record<string, unknown>;

/** A custom-attribute value → a human-readable string for a table cell / display. */
export function formatAttributeValue(def: UserAttributeDefinition, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  switch (def.attr_type) {
    case "checkbox":
      return raw ? "Yes" : "No";
    case "date": {
      const d = new Date(String(raw));
      return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString();
    }
    case "dropdown": {
      const opt = def.options.find((o) => o.value === raw);
      return opt ? opt.label : String(raw);
    }
    case "multiselect": {
      const arr = Array.isArray(raw) ? raw : [raw];
      if (arr.length === 0) return "—";
      return arr
        .map((v) => def.options.find((o) => o.value === v)?.label ?? String(v))
        .join(", ");
    }
    default:
      return String(raw);
  }
}

/** First required-but-empty attribute's name, or null when all are satisfied.
 *  Skips a required option attribute that has no active options (can't satisfy). */
export function firstMissingRequired(
  defs: UserAttributeDefinition[],
  values: AttrValues,
): string | null {
  for (const def of defs) {
    if (!def.is_required || !def.is_active) continue;
    const isOption = def.attr_type === "dropdown" || def.attr_type === "multiselect";
    if (isOption && def.options.filter((o) => o.is_active).length === 0) continue;
    const v = values[def.key];
    const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) return def.name;
  }
  return null;
}

function MultiSelectControl({
  def,
  value,
  onChange,
  disabled,
}: {
  def: UserAttributeDefinition;
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const opts = def.options.filter((o) => o.is_active);
  function toggle(optValue: string, on: boolean) {
    onChange(on ? [...value, optValue] : value.filter((x) => x !== optValue));
  }
  if (opts.length === 0) {
    return <p className="text-xs text-muted-foreground">No options configured.</p>;
  }
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {opts.map((o) => (
        <label
          key={o.id}
          className="flex items-center gap-2 rounded px-1.5 py-0.5 text-sm hover:bg-accent/50"
        >
          <Checkbox
            checked={value.includes(o.value)}
            disabled={disabled}
            onCheckedChange={(c) => toggle(o.value, Boolean(c))}
          />
          <span className="min-w-0 truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** One labelled control for a single attribute. */
export function AttributeInput({
  def,
  value,
  onChange,
  disabled,
}: {
  def: UserAttributeDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const id = `attr-${def.key}`;
  const label = (
    <Label htmlFor={id}>
      {def.name}
      {def.is_required ? <span className="text-destructive"> *</span> : null}
    </Label>
  );

  if (def.attr_type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(c) => onChange(Boolean(c))}
        />
        <span>
          {def.name}
          {def.is_required ? <span className="text-destructive"> *</span> : null}
        </span>
      </label>
    );
  }

  if (def.attr_type === "multiselect") {
    return (
      <div className="space-y-1.5">
        {label}
        <MultiSelectControl
          def={def}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  if (def.attr_type === "dropdown") {
    const opts = def.options.filter((o) => o.is_active);
    return (
      <div className="space-y-1.5">
        {label}
        <select
          id={id}
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`${SELECT_CLASS} w-full`}
        >
          <option value="">— select —</option>
          {opts.map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const type = def.attr_type === "number" ? "number" : def.attr_type === "date" ? "date" : "text";
  // <input type=date> needs a bare YYYY-MM-DD; stored values are ISO datetimes.
  const inputValue =
    def.attr_type === "date" && value ? String(value).slice(0, 10) : (value as string | number | undefined) ?? "";
  return (
    <div className="space-y-1.5">
      {label}
      <Input
        id={id}
        type={type}
        value={inputValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Renders every active attribute as a control. Used in create + edit dialogs. */
export function AttributeFieldsForm({
  defs,
  values,
  onChange,
  disabled,
}: {
  defs: UserAttributeDefinition[];
  values: AttrValues;
  onChange: (key: string, v: unknown) => void;
  disabled?: boolean;
}) {
  const active = defs.filter((d) => d.is_active);
  if (active.length === 0) return null;
  return (
    <div className="space-y-3">
      {active.map((def) => (
        <AttributeInput
          key={def.id}
          def={def}
          value={values[def.key]}
          onChange={(v) => onChange(def.key, v)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
