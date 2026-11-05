"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { selectCls } from "@/components/tickets/field-styles";
import { ASSET_STATE_TYPES } from "@/lib/itsm/assets-types";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { fmtDate, hasFilters, type FilterKey, type FilterValues } from "./asset-utils";
import type { AssetLookups } from "./use-asset-lookups";

const NONE = "none";

const WARRANTY_OPTIONS = [
  { value: "expiring", label: "Ending in 30 days" },
  { value: "expired", label: "Ended" },
  { value: "covered", label: "Covered" },
  { value: "none", label: "No warranty date" },
];

const EXPIRY_LABELS: Record<string, string> = {
  expiring: "Expires in 30 days",
  passed: "Expiry date passed",
  none: "No expiry date",
};

type Opt = { value: string; label: string };

/** A native select with an "All" first option. A URL value that isn't one of the
 *  options (a comma list, an inactive item) is kept as an extra "Selected" option so the
 *  control never silently shows "All" while a filter is applied. */
function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const known = !value || options.some((o) => o.value === value);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(selectCls, "w-full sm:w-40", value && "border-primary/50 text-foreground", className)}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {!known ? <option value={value}>{value === NONE ? "None" : "Selected"}</option> : null}
    </select>
  );
}

/** Removable chip for a filter that has no select (it arrives from a drill-through link). */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-primary/10 py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-primary-ink">
      {label}
      <IconButton
        label={`Remove filter: ${label}`}
        className="h-6 w-6 rounded-full hover:bg-primary/20"
        onClick={onRemove}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </IconButton>
    </span>
  );
}

function withNone(items: { id: string; name: string; is_active?: boolean }[], noneLabel: string): Opt[] {
  return [
    ...items.map((i) => ({ value: i.id, label: i.is_active === false ? `${i.name} (inactive)` : i.name })),
    { value: NONE, label: noneLabel },
  ];
}

/** The filter bar shared by the Asset List and the Asset Report. Values live in the URL;
 *  the search box is debounced (300 ms) before it reports a change. */
export function AssetFilterBar({
  values,
  onChange,
  lookups,
  className,
}: {
  values: FilterValues;
  /** A patch: keys set to "" are cleared. */
  onChange: (patch: FilterValues) => void;
  lookups: AssetLookups;
  className?: string;
}) {
  const [q, setQ] = useState(values.search ?? "");
  const lastSent = useRef(values.search ?? "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // An outside change (Clear, back/forward) resets the box.
  useEffect(() => {
    const ext = values.search ?? "";
    if (ext !== lastSent.current) {
      lastSent.current = ext;
      setQ(ext);
    }
  }, [values.search]);

  useEffect(() => {
    if (q === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = q;
      onChangeRef.current({ search: q.trim() ? q : "" });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const set = (key: FilterKey) => (v: string) => onChange({ [key]: v });
  const subs = lookups.subCategoriesOf(values.category);

  const chips: { key: FilterKey; label: string }[] = [];
  // A sub-category filter without its category (e.g. from a report drill-through) has no
  // visible select, so it shows as a chip.
  if (values.sub_category && !values.category) {
    const sub = lookups.categories.find((c) => c.id === values.sub_category);
    chips.push({
      key: "sub_category",
      label: values.sub_category === NONE ? "No sub-category" : sub ? `Sub-category: ${sub.name}` : "Sub-category",
    });
  }
  if (values.assigned_user) chips.push({ key: "assigned_user", label: values.assigned_user === NONE ? "Not allotted to a user" : "Allotted user" });
  if (values.expiry) chips.push({ key: "expiry", label: EXPIRY_LABELS[values.expiry] ?? `Expiry: ${values.expiry}` });
  if (values.import) chips.push({ key: "import", label: "From one import" });
  if (values.purchased_from) chips.push({ key: "purchased_from", label: `Purchased from ${fmtDate(values.purchased_from)}` });
  if (values.purchased_to) chips.push({ key: "purchased_to", label: `Purchased until ${fmtDate(values.purchased_to)}` });

  const clearAll = () => {
    lastSent.current = "";
    setQ("");
    onChange({
      search: "", category: "", sub_category: "", status: "", state_type: "", location: "",
      department: "", vendor: "", assigned_user: "", warranty: "", expiry: "", import: "",
      purchased_from: "", purchased_to: "",
    });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tag, name, user, details…"
            aria-label="Search assets"
            className="h-[var(--ctl-h)] pl-8 pr-8"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <InfoTip label="About asset search">{ASSET_HELP.search}</InfoTip>
          </span>
        </div>
        <FilterSelect
          label="Category"
          allLabel="All categories"
          value={values.category ?? ""}
          options={lookups.topCategories.map((c) => ({ value: c.id, label: c.is_active ? c.name : `${c.name} (inactive)` }))}
          onChange={(v) => onChange({ category: v, sub_category: "" })}
        />
        {values.category ? (
          <FilterSelect
            label="Sub-category"
            allLabel="All sub-categories"
            value={values.sub_category ?? ""}
            options={withNone(subs, "No sub-category")}
            onChange={set("sub_category")}
          />
        ) : null}
        <FilterSelect
          label="Status"
          allLabel="All statuses"
          value={values.status ?? ""}
          options={lookups.statuses.map((s) => ({ value: s.id, label: s.name }))}
          onChange={set("status")}
        />
        <span className="inline-flex w-full items-center gap-1.5 sm:w-auto">
          <FilterSelect
            label="State type"
            allLabel="All state types"
            value={values.state_type ?? ""}
            options={[{ value: "active", label: "Active (any)" }, ...ASSET_STATE_TYPES]}
            onChange={set("state_type")}
          />
          <InfoTip label="About state types">{ASSET_HELP.filterStateType}</InfoTip>
        </span>
        <FilterSelect
          label="Location"
          allLabel="All locations"
          value={values.location ?? ""}
          options={withNone(lookups.locations, "No location")}
          onChange={set("location")}
        />
        <FilterSelect
          label="Department"
          allLabel="All departments"
          value={values.department ?? ""}
          options={withNone(lookups.departments, "No department")}
          onChange={set("department")}
        />
        <FilterSelect
          label="Vendor"
          allLabel="All vendors"
          value={values.vendor ?? ""}
          options={withNone(lookups.vendors, "No vendor")}
          onChange={set("vendor")}
        />
        <span className="inline-flex w-full items-center gap-1.5 sm:w-auto">
          <FilterSelect
            label="Warranty"
            allLabel="Any warranty"
            value={values.warranty ?? ""}
            options={WARRANTY_OPTIONS}
            onChange={set("warranty")}
          />
          <InfoTip label="About the warranty filter">{ASSET_HELP.filterWarranty}</InfoTip>
        </span>
        {hasFilters(values) ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear filters
          </Button>
        ) : null}
      </div>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <FilterChip key={c.key} label={c.label} onRemove={() => onChange({ [c.key]: "" })} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
