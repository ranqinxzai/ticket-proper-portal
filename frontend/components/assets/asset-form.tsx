"use client";

/**
 * Create / edit an asset: five section cards (General, Location, Allotment, Purchase,
 * Details) + a sticky action bar. Detail fields come from `assets/form-fields/` for the
 * chosen category + sub-category and render through the user-attribute `AttributeInput`
 * via a small adapter (that shared file is not edited). Every sub-component is
 * module-level (React focus stability).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  ListTree,
  Loader2,
  MapPin,
  Receipt,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { FieldRow } from "@/components/settings/field-row";
import { AttributeInput } from "@/components/settings/user-attribute-fields";
import { UserSearchCombobox } from "@/components/settings/user-search-combobox";
import { inputCls, selectCls, textareaCls } from "@/components/tickets/field-styles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { assetUsersApi, assetsApi } from "@/lib/itsm/assets-api";
import {
  ACTIVE_STATE_TYPES,
  ASSET_STATE_TYPES,
  type AssetDetail,
  type AssetDetailField,
  type AssetInput,
  type DetailValue,
  type Ref,
} from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import type { UserAttributeDefinition, UserRef } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";

import { fieldErr, fmtDate, todayIso, userLabel } from "./asset-utils";
import { useAssetLookups } from "./use-asset-lookups";

// ── Model ────────────────────────────────────────────────────────────────────

type Draft = {
  name: string;
  asset_tag: string;
  category: string;
  sub_category: string;
  status: string;
  vendor: string;
  location: string;
  department: string;
  user: { id: string; label: string } | null;
  allotment_notes: string;
  purchase_date: string;
  purchase_cost: string;
  expiry_date: string;
  warranty_expiry_date: string;
};

type Errors = Record<string, string[]>;

const CORE_KEYS = new Set([
  "name", "asset_tag", "category", "sub_category", "status", "vendor", "location", "department",
  "assigned_user", "allotment_notes", "purchase_date", "purchase_cost", "expiry_date", "warranty_expiry_date",
]);

function draftFrom(a?: AssetDetail | null): Draft {
  return {
    name: a?.name ?? "",
    asset_tag: a?.asset_tag ?? "",
    category: a?.category?.id ?? "",
    sub_category: a?.sub_category?.id ?? "",
    status: a?.status?.id ?? "",
    vendor: a?.vendor?.id ?? "",
    location: a?.location?.id ?? "",
    department: a?.department?.id ?? "",
    user: a?.assigned_user ? { id: String(a.assigned_user.id), label: userLabel(a.assigned_user) } : null,
    allotment_notes: a?.allotment_notes ?? "",
    purchase_date: a?.purchase_date ?? "",
    purchase_cost: a?.purchase_cost ?? "",
    expiry_date: a?.expiry_date ?? "",
    warranty_expiry_date: a?.warranty_expiry_date ?? "",
  };
}

function isEmptyValue(v: DetailValue | undefined): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** AssetDetailField → the UserAttributeDefinition shape `AttributeInput` renders. */
function toAttrDef(f: AssetDetailField, i: number): UserAttributeDefinition {
  return {
    id: f.id,
    key: f.key,
    name: f.name,
    description: f.help_text,
    attr_type: f.field_type,
    is_required: f.is_required,
    show_in_table: false,
    sort_order: i,
    is_active: true,
    options: f.options.map((o, j) => ({
      id: o.id,
      attribute: f.id,
      value: o.value,
      label: o.label,
      sort_order: j,
      is_active: true,
    })),
  };
}

/** What the API stores for one detail field (AttributeInput returns numbers as strings). */
function wireValue(f: AssetDetailField, v: unknown): DetailValue {
  if (f.field_type === "checkbox") return Boolean(v);
  if (f.field_type === "multiselect") return Array.isArray(v) ? (v as string[]) : [];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Options for a select, keeping the asset's current (possibly inactive) value listed.
 *  While the lists load (`loading`), the current value is shown without the suffix. */
function withCurrent<T extends { id: string; name: string }>(
  list: T[],
  current: Ref | null | undefined,
  loading: boolean,
): { id: string; name: string }[] {
  const out = list.map((x) => ({ id: x.id, name: x.name }));
  if (current && !out.some((x) => x.id === current.id)) {
    out.unshift({ id: current.id, name: loading ? current.name : `${current.name} (inactive)` });
  }
  return out;
}

async function searchAssetUsers(q: string): Promise<UserRef[]> {
  const rows = await assetUsersApi.search(q);
  return rows.map((u) => ({ id: String(u.id), username: u.username, full_name: u.full_name, email: u.email }));
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function FormSection({
  icon,
  title,
  help,
  right,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  help?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-soft transition-shadow duration-200 hover:shadow-soft-md">
      <header className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3.5 compact:px-3.5 compact:py-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground compact:h-6 compact:w-6">
          {icon}
        </span>
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          {help ? <InfoTip label="About this section">{help}</InfoTip> : null}
        </h2>
        {right ? <div className="ml-auto">{right}</div> : null}
      </header>
      <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2 sm:p-6 compact:gap-3.5 compact:p-3.5">{children}</div>
    </section>
  );
}

function Picker({
  id,
  value,
  onChange,
  options,
  noneLabel,
  disabled,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  /** Adds an empty option with this label (omit for a required pick with a placeholder). */
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(selectCls, invalid && "border-destructive")}
    >
      <option value="">{noneLabel ?? "— Select —"}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function InlineNotice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 sm:col-span-2"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

type PendingCategory = {
  prev: { category: string; sub_category: string };
  fields: AssetDetailField[];
  dropped: AssetDetailField[];
};

// ── Form ─────────────────────────────────────────────────────────────────────

export function AssetForm({
  asset,
  readOnly = false,
  base,
  onSaved,
  aside,
}: {
  /** Edit mode when set; create otherwise. */
  asset?: AssetDetail | null;
  readOnly?: boolean;
  /** Workspace base path (`/t/<org>/agent/w/<hd>`). */
  base: string;
  onSaved: (asset: AssetDetail, created: boolean) => void;
  /** Right-hand column (the History card on the edit page). */
  aside?: ReactNode;
}) {
  const { helpdesk } = useWorkspace();
  const lookups = useAssetLookups(helpdesk?.id, { activeOnly: true });
  const isEdit = !!asset;

  const [original, setOriginal] = useState<AssetDetail | null>(asset ?? null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(asset));
  const [fields, setFields] = useState<AssetDetailField[]>(asset?.detail_fields ?? []);
  const [details, setDetails] = useState<Record<string, DetailValue>>(asset?.details ?? {});
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingCategory | null>(null);
  const fieldsSeq = useRef(0);
  const fieldsKey = useRef(asset ? `${asset.category.id}|${asset.sub_category?.id ?? ""}` : "|");
  const disabled = readOnly || busy;

  // New asset: preselect the default status once, when the statuses load.
  const statusInit = useRef(isEdit);
  useEffect(() => {
    if (statusInit.current || lookups.statuses.length === 0) return;
    statusInit.current = true;
    const def = lookups.statuses.find((s) => s.is_default) ?? lookups.statuses[0];
    if (def) setDraft((d) => (d.status ? d : { ...d, status: def.id }));
  }, [lookups.statuses]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K], errKey: string = key) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      if (!e[errKey]) return e;
      const next = { ...e };
      delete next[errKey];
      return next;
    });
  };

  const attrDefs = useMemo(() => fields.map(toAttrDef), [fields]);
  const status = lookups.statuses.find((s) => s.id === draft.status) ?? null;
  const statusState = status?.state_type ?? (draft.status === original?.status.id ? original?.status.state_type : undefined);
  const expiredTarget = lookups.statuses.find((s) => s.auto_expire_target) ?? null;

  const today = todayIso();
  const expiryPassed = !!draft.expiry_date && draft.expiry_date < today;
  const expiryRelevant =
    !isEdit || draft.status !== original?.status.id || draft.expiry_date !== (original?.expiry_date ?? "");
  const expiryBlock =
    expiryPassed && !!statusState && ACTIVE_STATE_TYPES.includes(statusState) && expiryRelevant;
  const statusName = status?.name ?? original?.status.name ?? "";
  const inUseMissing = statusState === "in_use" && !draft.user && !draft.department;

  const lk = lookups.loading;
  const topOptions = withCurrent(lookups.topCategories, original?.category, lk);
  const subOptions = withCurrent(
    lookups.subCategoriesOf(draft.category),
    original && original.category.id === draft.category ? original.sub_category : null,
    lk,
  );
  const catName = topOptions.find((c) => c.id === draft.category)?.name.replace(/ \(inactive\)$/, "") ?? "";
  const subName = subOptions.find((c) => c.id === draft.sub_category)?.name.replace(/ \(inactive\)$/, "") ?? "";

  /** Category / sub-category change: load the new detail fields, and confirm first when
   *  values of fields that won't apply any more would be removed. */
  async function changeCategory(category: string, sub_category: string) {
    const prev = { category: draft.category, sub_category: draft.sub_category };
    setDraft((d) => ({ ...d, category, sub_category }));
    setErrors((e) => {
      const next = { ...e };
      delete next.category;
      delete next.sub_category;
      return next;
    });
    const key = `${category}|${sub_category}`;
    if (key === fieldsKey.current) return;
    const my = ++fieldsSeq.current;
    if (!category) {
      fieldsKey.current = key;
      applyFields([]);
      return;
    }
    setFieldsLoading(true);
    try {
      const next = await assetsApi.formFields({ helpdesk: helpdesk?.id, category, sub_category: sub_category || null });
      if (my !== fieldsSeq.current) return;
      const keep = new Set(next.map((f) => f.key));
      const dropped = fields.filter((f) => !keep.has(f.key) && !isEmptyValue(details[f.key]));
      if (dropped.length) {
        setPending({ prev, fields: next, dropped });
      } else {
        fieldsKey.current = key;
        applyFields(next);
      }
    } catch (e) {
      if (my !== fieldsSeq.current) return;
      toast.error(e instanceof ItsmApiError ? e.message : "Could not load the detail fields.");
    } finally {
      if (my === fieldsSeq.current) setFieldsLoading(false);
    }
  }

  function applyFields(next: AssetDetailField[]) {
    setFields(next);
    setDetails((cur) => {
      const out: Record<string, DetailValue> = {};
      for (const f of next) if (f.key in cur) out[f.key] = cur[f.key];
      return out;
    });
  }

  function confirmCategory() {
    if (!pending) return;
    fieldsKey.current = `${draft.category}|${draft.sub_category}`;
    applyFields(pending.fields);
    setPending(null);
  }

  function cancelCategory() {
    if (!pending) return;
    setDraft((d) => ({ ...d, ...pending.prev }));
    setPending(null);
  }

  function setDetail(key: string, v: unknown) {
    setDetails((d) => ({ ...d, [key]: v as DetailValue }));
    setErrors((e) => {
      const k = `details.${key}`;
      if (!e[k]) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });
  }

  function validate(): Errors {
    const out: Errors = {};
    const add = (k: string, m: string) => (out[k] = [...(out[k] ?? []), m]);
    if (!draft.name.trim()) add("name", "Enter the asset name.");
    if (!draft.category) add("category", "Choose a category.");
    if (!draft.status) add("status", "Choose a status.");
    else if (expiryBlock) add("status", ASSET_HELP.expiryPassed(draft.expiry_date));
    if (inUseMissing) add("assigned_user", ASSET_HELP.inUseNeedsOwner(statusName));
    const cost = draft.purchase_cost.trim();
    if (cost && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) add("purchase_cost", "Enter an amount of 0 or more.");
    for (const k of ["expiry_date", "warranty_expiry_date"] as const) {
      if (draft[k] && draft.purchase_date && draft[k] < draft.purchase_date) add(k, "Can't be before the purchase date.");
    }
    for (const f of fields) {
      if (!f.is_required || f.field_type === "checkbox") continue;
      if ((f.field_type === "dropdown" || f.field_type === "multiselect") && f.options.length === 0) continue;
      if (isEmptyValue(details[f.key])) add(`details.${f.key}`, "This field is required.");
    }
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || !helpdesk) return;
    const local = validate();
    if (Object.keys(local).length) {
      setErrors(local);
      toast.error("Please fix the highlighted fields.");
      return;
    }
    const body: AssetInput = {
      name: draft.name.trim(),
      asset_tag: draft.asset_tag.trim(),
      category: draft.category || null,
      sub_category: draft.sub_category || null,
      status: draft.status || null,
      vendor: draft.vendor || null,
      location: draft.location || null,
      department: draft.department || null,
      assigned_user: draft.user?.id ?? null,
      allotment_notes: draft.allotment_notes,
      purchase_date: draft.purchase_date || null,
      purchase_cost: draft.purchase_cost.trim() || null,
      expiry_date: draft.expiry_date || null,
      warranty_expiry_date: draft.warranty_expiry_date || null,
      details: Object.fromEntries(fields.map((f) => [f.key, wireValue(f, details[f.key])])),
    };
    setBusy(true);
    setErrors({});
    try {
      const saved = isEdit && original
        ? await assetsApi.update(original.id, body)
        : await assetsApi.create({ ...body, helpdesk: helpdesk.id });
      if (isEdit) {
        setOriginal(saved);
        setDraft(draftFrom(saved));
        setFields(saved.detail_fields);
        setDetails(saved.details);
        fieldsKey.current = `${saved.category.id}|${saved.sub_category?.id ?? ""}`;
      }
      toast.success(isEdit ? "Asset saved." : `Asset ${saved.asset_tag} created.`);
      onSaved(saved, !isEdit);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        const fe = err.fieldErrors ?? {};
        setErrors(fe);
        const shown = (k: string) => CORE_KEYS.has(k) || (k.startsWith("details.") && fields.some((f) => `details.${f.key}` === k));
        const hidden = Object.entries(fe).find(([k]) => !shown(k));
        toast.error(hidden?.[1]?.[0] ?? err.message);
      } else {
        toast.error(isEdit ? "Could not save the asset." : "Could not create the asset.");
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => fieldErr(errors, k);
  const detailsTitle = subName ? `Details · ${catName} › ${subName}` : catName ? `Details · ${catName}` : "Details";

  return (
    <form onSubmit={submit} className="space-y-6 compact:space-y-4" noValidate>
      <div className={aside ? "grid gap-6 compact:gap-4 xl:grid-cols-[minmax(0,1fr)_380px]" : "mx-auto max-w-4xl"}>
        <fieldset disabled={readOnly} className="min-w-0 space-y-6 compact:space-y-4">
          <FormSection icon={<Boxes className="h-4 w-4" aria-hidden="true" />} title="General">
            {!lookups.loading && lookups.topCategories.length === 0 && !isEdit ? (
              <InlineNotice
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${base}/settings/assets/categories`}>Set up categories</Link>
                  </Button>
                }
              >
                This helpdesk has no asset categories yet, and every asset needs one.
              </InlineNotice>
            ) : null}
            <FieldRow label="Asset Name" htmlFor="asset-name" required error={err("name")}>
              <input
                id="asset-name"
                className={cn(inputCls, err("name") && "border-destructive")}
                value={draft.name}
                maxLength={200}
                disabled={disabled}
                aria-invalid={!!err("name") || undefined}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Dell Latitude 5440"
              />
            </FieldRow>
            <FieldRow label="Asset Tag" htmlFor="asset-tag" info={ASSET_HELP.assetTag} error={err("asset_tag")}>
              <input
                id="asset-tag"
                spellCheck={false}
                className={cn(inputCls, "font-mono", err("asset_tag") && "border-destructive")}
                value={draft.asset_tag}
                maxLength={64}
                disabled={disabled}
                aria-invalid={!!err("asset_tag") || undefined}
                onChange={(e) => set("asset_tag", e.target.value)}
                placeholder={isEdit ? "" : "Leave blank to auto-number"}
              />
            </FieldRow>
            <FieldRow label="Category" htmlFor="asset-category" required info={ASSET_HELP.category} error={err("category")}>
              <Picker
                id="asset-category"
                value={draft.category}
                options={topOptions}
                disabled={disabled}
                invalid={!!err("category")}
                onChange={(v) => void changeCategory(v, "")}
              />
            </FieldRow>
            <FieldRow label="Sub-category" htmlFor="asset-sub" info={ASSET_HELP.subCategory} error={err("sub_category")}>
              <Picker
                id="asset-sub"
                value={draft.sub_category}
                options={subOptions}
                noneLabel={draft.category ? (subOptions.length ? "— None —" : "No sub-categories") : "Pick a category first"}
                disabled={disabled || !draft.category || subOptions.length === 0}
                invalid={!!err("sub_category")}
                onChange={(v) => void changeCategory(draft.category, v)}
              />
            </FieldRow>
            <FieldRow label="Vendor" htmlFor="asset-vendor" info={ASSET_HELP.vendor} error={err("vendor")}>
              <Picker
                id="asset-vendor"
                value={draft.vendor}
                options={withCurrent(lookups.vendors, original?.vendor, lk)}
                noneLabel="— None —"
                disabled={disabled}
                invalid={!!err("vendor")}
                onChange={(v) => set("vendor", v)}
              />
            </FieldRow>
            <FieldRow
              label="Status"
              htmlFor="asset-status"
              required
              info={ASSET_HELP.status}
              error={err("status")}
              hint={
                statusState
                  ? `State type: ${ASSET_STATE_TYPES.find((t) => t.value === statusState)?.label ?? statusState}`
                  : undefined
              }
            >
              <Picker
                id="asset-status"
                value={draft.status}
                options={withCurrent(lookups.statuses, original?.status, lk)}
                disabled={disabled}
                invalid={!!err("status")}
                onChange={(v) => set("status", v)}
              />
            </FieldRow>
            {expiryBlock && !readOnly ? (
              <InlineNotice
                action={
                  expiredTarget && expiredTarget.id !== draft.status ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => set("status", expiredTarget.id)}>
                      Use {expiredTarget.name}
                    </Button>
                  ) : null
                }
              >
                {ASSET_HELP.expiryPassed(fmtDate(draft.expiry_date))}
              </InlineNotice>
            ) : null}
          </FormSection>

          <FormSection icon={<MapPin className="h-4 w-4" aria-hidden="true" />} title="Location">
            <FieldRow label="Location" htmlFor="asset-location" info={ASSET_HELP.location} error={err("location")}>
              <Picker
                id="asset-location"
                value={draft.location}
                options={withCurrent(lookups.locations, original?.location, lk)}
                noneLabel="— None —"
                disabled={disabled}
                invalid={!!err("location")}
                onChange={(v) => set("location", v)}
              />
            </FieldRow>
          </FormSection>

          <FormSection icon={<UserRound className="h-4 w-4" aria-hidden="true" />} title="Allotment">
            <FieldRow
              label="User"
              htmlFor="asset-user"
              info={ASSET_HELP.user}
              error={err("assigned_user")}
              hint={
                !err("assigned_user") && inUseMissing && !readOnly ? (
                  <span className="text-amber-700 dark:text-amber-400">{ASSET_HELP.inUseNeedsOwner(statusName)}</span>
                ) : undefined
              }
            >
              <UserSearchCombobox
                id="asset-user"
                value={draft.user?.label ?? null}
                placeholder="Search people…"
                disabled={disabled}
                search={searchAssetUsers}
                onSelect={(u) => {
                  set("user", { id: String(u.id), label: u.full_name || u.username }, "assigned_user");
                }}
                onClear={() => set("user", null, "assigned_user")}
              />
            </FieldRow>
            <FieldRow label="Department" htmlFor="asset-dept" info={ASSET_HELP.department} error={err("department")}>
              <Picker
                id="asset-dept"
                value={draft.department}
                options={withCurrent(lookups.departments, original?.department, lk)}
                noneLabel="— None —"
                disabled={disabled}
                invalid={!!err("department")}
                onChange={(v) => {
                  set("department", v);
                  setErrors((e) => {
                    if (!e.assigned_user) return e;
                    const next = { ...e };
                    delete next.assigned_user;
                    return next;
                  });
                }}
              />
            </FieldRow>
            <div className="sm:col-span-2">
              <FieldRow label="Notes" htmlFor="asset-notes" info={ASSET_HELP.allotmentNotes} error={err("allotment_notes")}>
                <textarea
                  id="asset-notes"
                  rows={3}
                  maxLength={2000}
                  className={textareaCls}
                  value={draft.allotment_notes}
                  disabled={disabled}
                  onChange={(e) => set("allotment_notes", e.target.value)}
                />
              </FieldRow>
            </div>
            {original?.allotted_at ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Allotted {new Date(original.allotted_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            ) : null}
          </FormSection>

          <FormSection icon={<Receipt className="h-4 w-4" aria-hidden="true" />} title="Purchase">
            <FieldRow label="Purchase Date" htmlFor="asset-pdate" error={err("purchase_date")}>
              <input
                id="asset-pdate"
                type="date"
                className={inputCls}
                value={draft.purchase_date}
                disabled={disabled}
                onChange={(e) => set("purchase_date", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Purchase Cost" htmlFor="asset-cost" info={ASSET_HELP.purchaseCost} error={err("purchase_cost")}>
              <input
                id="asset-cost"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className={cn(inputCls, err("purchase_cost") && "border-destructive")}
                value={draft.purchase_cost}
                disabled={disabled}
                onChange={(e) => set("purchase_cost", e.target.value)}
                placeholder="0.00"
              />
            </FieldRow>
            <FieldRow label="Expiry Date" htmlFor="asset-expiry" info={ASSET_HELP.expiryDate} error={err("expiry_date")}>
              <input
                id="asset-expiry"
                type="date"
                className={cn(inputCls, (err("expiry_date") || expiryBlock) && "border-amber-500")}
                value={draft.expiry_date}
                disabled={disabled}
                onChange={(e) => set("expiry_date", e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Warranty Expiry Date"
              htmlFor="asset-warranty"
              info={ASSET_HELP.warrantyExpiry}
              error={err("warranty_expiry_date")}
            >
              <input
                id="asset-warranty"
                type="date"
                className={inputCls}
                value={draft.warranty_expiry_date}
                disabled={disabled}
                onChange={(e) => set("warranty_expiry_date", e.target.value)}
              />
            </FieldRow>
          </FormSection>

          <FormSection
            icon={<ListTree className="h-4 w-4" aria-hidden="true" />}
            title={detailsTitle}
            help={ASSET_HELP.details}
            right={fieldsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading fields" /> : null}
          >
            {!draft.category ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">Pick a category to see its detail fields.</p>
            ) : fields.length === 0 && !fieldsLoading ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {subName ? `“${catName} › ${subName}”` : `“${catName}”`} has no detail fields.
                {" "}They are set up under Configuration → Categories &amp; Fields.
              </p>
            ) : (
              fields.map((f, i) => {
                const e = err(`details.${f.key}`);
                const from = f.inherited && draft.sub_category ? catName : "";
                return (
                  <div key={f.key} className={cn("min-w-0", f.field_type === "multiselect" && "sm:col-span-2")}>
                    <AttributeInput
                      def={attrDefs[i]}
                      value={details[f.key]}
                      onChange={(v) => setDetail(f.key, v)}
                      disabled={disabled}
                    />
                    {f.help_text || from ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {f.help_text}
                        {f.help_text && from ? " · " : ""}
                        {from ? `From ${from}` : ""}
                      </p>
                    ) : null}
                    {e ? <p className="mt-1 text-xs font-medium text-destructive">{e}</p> : null}
                  </div>
                );
              })
            )}
          </FormSection>
        </fieldset>

        {aside ? (
          // Named: the workspace sidebar is the page's other <aside> (axe landmark-unique).
          <aside aria-label="Tickets, documents and history" className="min-w-0 space-y-4 xl:sticky xl:top-rail xl:max-h-[calc(100dvh_-_var(--header-h)_-_2_*_var(--main-py))] xl:self-start xl:overflow-y-auto">
            {aside}
          </aside>
        ) : null}
      </div>

      {!readOnly ? (
        <div className="sticky bottom-0 z-30 -mx-main-x flex items-center justify-end gap-2 border-t bg-card/95 px-main-x py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 compact:py-2">
          <Button asChild variant="ghost">
            <Link href={`${base}/assets/list`}>Cancel</Link>
          </Button>
          <Hint label={fieldsLoading ? "Loading the category's detail fields…" : undefined}>
            <Button type="submit" disabled={busy || !helpdesk || fieldsLoading}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {busy ? "Saving…" : isEdit ? "Save changes" : "Create asset"}
            </Button>
          </Hint>
        </div>
      ) : null}

      <Dialog open={!!pending} onOpenChange={(o) => !o && cancelCategory()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change the category?</DialogTitle>
            <DialogDescription>{ASSET_HELP.categoryChange}</DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">These values will be removed:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {pending.dropped.map((f) => (
                  <li key={f.key}>{f.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={cancelCategory}>
              Keep the current category
            </Button>
            <Button type="button" onClick={confirmCategory}>
              Change and remove values
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
