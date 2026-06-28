"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";

import type {
  FilterCondition,
  FilterFieldMeta,
  FilterFieldOption,
  FilterOperator,
  FilterValue,
} from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConditionValue } from "./condition-value";
import {
  conditionSummary,
  isConditionComplete,
  MULTI_OPS,
  operatorLabel,
  VALUELESS_OPS,
  type LabelResolver,
} from "./filter-utils";

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** When the operator changes, coerce the existing value into the new shape. */
function reconcileValue(nextOp: FilterOperator, prev: FilterValue | undefined): FilterValue | undefined {
  if (VALUELESS_OPS.has(nextOp)) return undefined;
  if (nextOp === "between") {
    const a = Array.isArray(prev) ? prev : [];
    return [String(a[0] ?? ""), String(a[1] ?? "")];
  }
  if (MULTI_OPS.has(nextOp)) {
    if (Array.isArray(prev)) return prev;
    return prev === undefined || prev === null || prev === "" ? [] : [prev as string];
  }
  // scalar target
  if (Array.isArray(prev)) return prev.length ? (prev[0] as string) : "";
  return prev ?? "";
}

export function FilterChip({
  field,
  condition,
  options,
  labelFor,
  registerUserLabel,
  onChange,
  onRemove,
  defaultOpen = false,
}: {
  field: FilterFieldMeta;
  condition: FilterCondition;
  options: FilterFieldOption[];
  labelFor: LabelResolver;
  registerUserLabel: (id: string, label: string) => void;
  onChange: (c: FilterCondition) => void;
  onRemove?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const complete = isConditionComplete(condition);

  return (
    <div className="inline-flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1 border-dashed font-normal",
              complete && "border-solid border-primary/40 bg-primary/5",
              onRemove && "rounded-r-none",
            )}
          >
            <span className="font-medium">{field.label}</span>
            {complete ? (
              <span className="text-muted-foreground">{conditionSummary(condition, field, labelFor)}</span>
            ) : (
              <span className="text-muted-foreground">{operatorLabel(condition.op)}…</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-3 p-3" align="start">
          <p className="text-sm font-medium">{field.label}</p>
          <select
            className={selectCls}
            aria-label={`${field.label} condition`}
            value={condition.op}
            onChange={(e) => {
              const nextOp = e.target.value as FilterOperator;
              onChange({ ...condition, op: nextOp, value: reconcileValue(nextOp, condition.value) });
            }}
          >
            {field.operators.map((op) => (
              <option key={op} value={op}>{operatorLabel(op)}</option>
            ))}
          </select>
          <ConditionValue
            field={field}
            condition={condition}
            options={options}
            labelFor={labelFor}
            registerUserLabel={registerUserLabel}
            onChange={(value) => onChange({ ...condition, value })}
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {onRemove ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Remove ${field.label} filter`}
          className={cn("h-8 rounded-l-none border-l-0 px-1.5",
            complete ? "border-primary/40 bg-primary/5" : "border-dashed")}
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
