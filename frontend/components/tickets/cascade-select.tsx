"use client";

import { selectCls } from "@/components/tickets/field-styles";

/** One node of a cascade tree. `parent` is the parent node's id; top-level nodes have none. */
export type CascadeNode = { id: string; value: string; label: string; parent?: string | null };

/**
 * Dependent selects for a cascade field: one per level, each listing the children of
 * the node picked above it. The value is the ordered path of option values (what
 * `FieldValue.value_json` stores). Choosing a node drops everything below it. Shared by
 * the ticket detail's inline editor and the automation "Set field" action.
 */
export function CascadeSelect({
  levels,
  options,
  value,
  disabled,
  onChange,
}: {
  levels?: string[];
  options: CascadeNode[];
  value: string[];
  disabled?: boolean;
  onChange: (path: string[]) => void;
}) {
  const names = levels?.length ? levels : ["Category"];
  const byValue = new Map(options.map((o) => [o.value, o]));

  const childrenAt = (level: number) => {
    if (level === 0) return options.filter((o) => !o.parent);
    const parentVal = value[level - 1];
    const parent = parentVal ? byValue.get(parentVal) : undefined;
    if (!parent) return [];
    return options.filter((o) => o.parent === parent.id);
  };

  const rendered: number[] = [];
  for (let i = 0; i < names.length; i++) {
    if (i === 0 || (value[i - 1] && childrenAt(i).length > 0)) rendered.push(i);
  }

  return (
    <div className="space-y-1">
      {rendered.map((i) => (
        <select
          key={i}
          disabled={disabled}
          value={value[i] ?? ""}
          className={selectCls}
          aria-label={names[i]}
          onChange={(e) => {
            const next = value.slice(0, i);
            if (e.target.value) next[i] = e.target.value;
            onChange(next);
          }}
        >
          <option value="">{`Select ${(names[i] ?? "level").toLowerCase()}…`}</option>
          {childrenAt(i).map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {options.length === 0 ? <p className="text-xs text-muted-foreground">No options configured.</p> : null}
    </div>
  );
}
