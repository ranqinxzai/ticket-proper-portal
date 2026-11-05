"use client";

/**
 * Create / edit a detail field of the helpdesk library, or link a field to a category
 * (an existing one, or a new one created on the spot). Options for dropdown /
 * multi-select are sent as the full `options_input` list: existing options by id (label,
 * order and active editable — their stored value never changes), new ones without id.
 * All sub-components are module-level (focus stability).
 */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { FieldRow } from "@/components/settings/field-row";
import { inputCls, selectCls, textareaCls } from "@/components/tickets/field-styles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { assetCategoryFieldsApi, assetFieldsApi } from "@/lib/itsm/assets-api";
import {
  ASSET_FIELD_TYPES,
  type AssetField,
  type AssetFieldInput,
  type AssetFieldType,
} from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { apiMessage, fieldErr } from "./asset-utils";

const OPTION_TYPES: AssetFieldType[] = ["dropdown", "multiselect"];

type OptDraft = { key: string; id?: string; value?: string; label: string; is_active: boolean };

let optSeq = 0;
const newKey = () => `n${++optSeq}`;

function OptionsEditor({
  options,
  onChange,
  disabled,
  error,
}: {
  options: OptDraft[];
  onChange: (next: OptDraft[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const [label, setLabel] = useState("");
  const add = () => {
    const l = label.trim();
    if (!l) return;
    onChange([...options, { key: newKey(), label: l, is_active: true }]);
    setLabel("");
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        Options
        <InfoTip label="About options">{ASSET_HELP.fieldOptions}</InfoTip>
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options yet. A dropdown with no options can&apos;t be required.</p>
      ) : (
        <ul className="space-y-1">
          {options.map((o, i) => (
            <li key={o.key} className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1">
              <input
                aria-label={`Option ${i + 1} label`}
                className={cn(inputCls, "h-8 min-w-0 flex-1")}
                value={o.label}
                disabled={disabled}
                onChange={(e) => onChange(options.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)))}
              />
              {o.id ? (
                <Hint label={o.is_active ? "Shown on asset forms. Untick to hide it; saved values are kept." : "Hidden from asset forms. Tick to show it again."}>
                  <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Checkbox
                      checked={o.is_active}
                      disabled={disabled}
                      onCheckedChange={(v) =>
                        onChange(options.map((x) => (x.key === o.key ? { ...x, is_active: Boolean(v) } : x)))
                      }
                    />
                    Active
                  </label>
                </Hint>
              ) : (
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary-ink">
                  New
                </span>
              )}
              <IconButton label={`Move ${o.label || "option"} up`} className="h-7 w-7" disabled={disabled || i === 0} disabledReason="Already first" onClick={() => move(i, -1)}>
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={`Move ${o.label || "option"} down`}
                className="h-7 w-7"
                disabled={disabled || i === options.length - 1}
                disabledReason="Already last"
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={`Remove ${o.label || "option"}`}
                detail={o.id ? "Removed when you save. Assets that use it keep the stored value, but it's no longer offered." : undefined}
                className="h-7 w-7 text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={() => onChange(options.filter((x) => x.key !== o.key))}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          aria-label="New option label"
          className={cn(inputCls, "h-8 max-w-xs")}
          placeholder="Add an option…"
          value={label}
          disabled={disabled}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Hint label={!label.trim() ? "Type an option label first" : undefined}>
          <Button type="button" size="sm" variant="outline" onClick={add} disabled={disabled || !label.trim()}>
            <Plus aria-hidden="true" /> Add
          </Button>
        </Hint>
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

export type FieldDialogMode =
  | { kind: "create" }
  | { kind: "edit"; field: AssetField }
  | { kind: "link"; categoryId: string; categoryName: string; linkedFieldIds: string[]; nextSortOrder: number };

export function AssetFieldDialog({
  open,
  mode,
  helpdeskId,
  library,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  mode: FieldDialogMode | null;
  helpdeskId: string;
  /** The helpdesk's fields (for "pick an existing field"). */
  library: AssetField[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [source, setSource] = useState<"existing" | "new">("existing");
  const [existingId, setExistingId] = useState("");
  const [required, setRequired] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetFieldType>("text");
  const [help, setHelp] = useState("");
  const [options, setOptions] = useState<OptDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const initFor = useRef<FieldDialogMode | null>(null);

  const linkable =
    mode?.kind === "link" ? library.filter((f) => f.is_active && !mode.linkedFieldIds.includes(f.id)) : [];

  // Reset whenever the dialog opens for a (new) target.
  useEffect(() => {
    if (!open || !mode || initFor.current === mode) return;
    initFor.current = mode;
    setErrors({});
    setBusy(false);
    setRequired(false);
    setExistingId("");
    if (mode.kind === "edit") {
      const f = mode.field;
      setName(f.name);
      setType(f.field_type);
      setHelp(f.help_text ?? "");
      setOptions(f.options.map((o) => ({ key: o.id, id: o.id, value: o.value, label: o.label, is_active: o.is_active })));
    } else {
      setName("");
      setType("text");
      setHelp("");
      setOptions([]);
    }
    setSource(mode.kind === "link" && linkable.length > 0 ? "existing" : "new");
    // linkable is derived from mode + library; mode identity drives the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  useEffect(() => {
    if (!open) initFor.current = null;
  }, [open]);

  if (!mode) return null;
  const isEdit = mode.kind === "edit";
  const typeLocked = isEdit && mode.field.value_count > 0;
  const isOptionType = OPTION_TYPES.includes(type);
  const showFieldEditor = mode.kind !== "link" || source === "new";

  async function save() {
    if (!mode) return;
    const errs: Record<string, string[]> = {};
    if (showFieldEditor && !name.trim()) errs.name = ["Enter a name."];
    if (mode.kind === "link" && source === "existing" && !existingId) errs.field = ["Pick a field."];
    if (showFieldEditor && isOptionType && options.some((o) => !o.label.trim())) errs.options_input = ["Every option needs a label."];
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      let fieldId = existingId;
      if (showFieldEditor) {
        const body: AssetFieldInput = { name: name.trim(), help_text: help.trim() };
        if (!typeLocked) body.field_type = type;
        if (isOptionType) {
          body.options_input = options.map((o, i) => ({
            id: o.id ?? null,
            label: o.label.trim(),
            sort_order: i,
            is_active: o.is_active,
          }));
        }
        if (isEdit) {
          await assetFieldsApi.update(mode.field.id, body);
        } else {
          const created = await assetFieldsApi.create({ ...body, helpdesk: helpdeskId, field_type: type });
          fieldId = created.id;
        }
      }
      if (mode.kind === "link") {
        try {
          await assetCategoryFieldsApi.create({
            category: mode.categoryId,
            field: fieldId,
            is_required: required,
            sort_order: mode.nextSortOrder,
          });
        } catch (e) {
          // The field itself was created; tell the user the link failed.
          onDone();
          throw e;
        }
      }
      toast.success(
        mode.kind === "link" ? `Field added to ${mode.categoryName}.` : isEdit ? "Field saved." : "Field created.",
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ItsmApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(apiMessage(e, "Could not save the field."));
    } finally {
      setBusy(false);
    }
  }

  const title = mode.kind === "edit" ? `Edit “${mode.field.name}”` : mode.kind === "link" ? `Add a field to ${mode.categoryName}` : "New field";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode.kind === "link"
              ? "Pick a field from this helpdesk's library, or create a new one. Sub-categories of this category get it too."
              : ASSET_HELP.fieldsLibrary}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode.kind === "link" ? (
            <div role="radiogroup" aria-label="Field source" className="inline-flex rounded-md border p-0.5">
              {(["existing", "new"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={source === s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    source === s ? "bg-primary/10 font-medium text-primary-ink" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "existing" ? "Existing field" : "New field…"}
                </button>
              ))}
            </div>
          ) : null}

          {mode.kind === "link" && source === "existing" ? (
            <FieldRow label="Field" htmlFor="af-existing" required error={fieldErr(errors, "field")}>
              {linkable.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every active field is already linked here. Create a new one.</p>
              ) : (
                <select
                  id="af-existing"
                  className={selectCls}
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                >
                  <option value="">— Select a field —</option>
                  {linkable.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({ASSET_FIELD_TYPES.find((t) => t.value === f.field_type)?.label ?? f.field_type})
                    </option>
                  ))}
                </select>
              )}
            </FieldRow>
          ) : null}

          {showFieldEditor ? (
            <>
              <FieldRow label="Name" htmlFor="af-name" required error={fieldErr(errors, "name")}>
                <input
                  id="af-name"
                  className={inputCls}
                  value={name}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Serial Number"
                />
              </FieldRow>
              <FieldRow label="Type" htmlFor="af-type" info={ASSET_HELP.fieldType} error={fieldErr(errors, "field_type")}>
                <Hint label={typeLocked ? ASSET_HELP.fieldTypeLocked : undefined}>
                  <select
                    id="af-type"
                    className={selectCls}
                    value={type}
                    disabled={busy || typeLocked}
                    onChange={(e) => setType(e.target.value as AssetFieldType)}
                  >
                    {ASSET_FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Hint>
              </FieldRow>
              <FieldRow label="Help text" htmlFor="af-help" hint="Shown under the field on the asset form." error={fieldErr(errors, "help_text")}>
                <textarea
                  id="af-help"
                  rows={2}
                  className={textareaCls}
                  value={help}
                  disabled={busy}
                  onChange={(e) => setHelp(e.target.value)}
                />
              </FieldRow>
              {isOptionType ? (
                <OptionsEditor options={options} onChange={setOptions} disabled={busy} error={fieldErr(errors, "options_input")} />
              ) : null}
            </>
          ) : null}

          {mode.kind === "link" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(Boolean(v))} disabled={busy} />
              Required for {mode.categoryName}
              <InfoTip label="About Required">{ASSET_HELP.required}</InfoTip>
            </label>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {mode.kind === "link" ? "Add field" : isEdit ? "Save" : "Create field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
