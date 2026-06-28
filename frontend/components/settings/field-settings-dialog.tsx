"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { fieldsApi, layoutsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type {
  FieldDefinition,
  FieldLayout,
  FieldLayoutItem,
  FieldVisibilityRule,
  Project,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

import { FieldRow } from "./field-row";

// Ticket attributes (not custom fields) that can drive a condition.
const BUILTIN_CONDITION_FIELDS = [{ key: "status", name: "Status" }];
const REGEX_TYPES = new Set(["text", "multiline", "richtext"]);

type Rule = FieldVisibilityRule;
const EMPTY_RULE: Rule = { action: "show", field: "status", operator: "eq", value: "" };

/**
 * Per-field Basic + Advanced settings.
 *  - Basic: Required, Tooltip, Hint text.
 *  - Advanced: Regex pattern (+ message), conditional Show / Read-only rule.
 *
 * Intrinsic props (tooltip/hint/regex) live on `FieldDefinition.config`; placement props
 * (required, conditional rule) live on the field's item in the project's **default layout**
 * (created on demand). Standard global fields share intrinsic config across projects;
 * required/rules are per-project.
 */
export function FieldSettingsDialog({
  field,
  project,
  canEdit,
  allFields,
  onOpenChange,
  onChanged,
}: {
  field: FieldDefinition | null;
  project: Project;
  canEdit: boolean;
  allFields: FieldDefinition[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [layout, setLayout] = useState<FieldLayout | null>(null);
  const [item, setItem] = useState<FieldLayoutItem | null>(null);

  const [required, setRequired] = useState(false);
  const [tooltip, setTooltip] = useState("");
  const [hint, setHint] = useState("");
  const [regex, setRegex] = useState("");
  const [regexMessage, setRegexMessage] = useState("");
  const [ruleOn, setRuleOn] = useState(false);
  const [rule, setRule] = useState<Rule>(EMPTY_RULE);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!field) return;
    setAdvancedOpen(false);
    const cfg = (field.config ?? {}) as Record<string, unknown>;
    setTooltip(String(cfg.tooltip ?? ""));
    setHint(String(cfg.hint ?? ""));
    setRegex(String(cfg.regex ?? ""));
    setRegexMessage(String(cfg.regex_message ?? ""));
    setLoading(true);
    layoutsApi
      .list(project.id)
      .then((layouts) => {
        const lay = layouts.find((l) => l.ticket_type == null) ?? layouts[0] ?? null;
        setLayout(lay);
        const it = lay?.items.find((i) => i.field === field.id) ?? null;
        setItem(it);
        setRequired(Boolean(it?.is_mandatory));
        const vr = (it?.visibility_rule ?? null) as Rule | null;
        if (vr && vr.field) {
          setRuleOn(true);
          setRule({
            action: vr.action === "readonly" ? "readonly" : "show",
            field: vr.field,
            operator: vr.operator === "neq" ? "neq" : "eq",
            value: String(vr.value ?? ""),
          });
        } else {
          setRuleOn(false);
          setRule(EMPTY_RULE);
        }
      })
      .catch(() => {
        setLayout(null);
        setItem(null);
      })
      .finally(() => setLoading(false));
  }, [field, project.id]);

  const conditionFields = useMemo(() => {
    const fromDefs = allFields
      .filter((f) => f.id !== field?.id)
      .map((f) => ({ key: f.key, name: f.name }));
    const keys = new Set(fromDefs.map((f) => f.key));
    return [...BUILTIN_CONDITION_FIELDS.filter((b) => !keys.has(b.key)), ...fromDefs];
  }, [allFields, field]);

  const showRegex = field ? REGEX_TYPES.has(field.field_type) : false;
  const isGlobal = field?.project == null;

  async function save() {
    if (!field) return;
    setSaving(true);
    try {
      // 1. intrinsic config on the field definition
      const nextConfig: Record<string, unknown> = {
        ...(field.config ?? {}),
        tooltip: tooltip.trim(),
        hint: hint.trim(),
        regex: showRegex ? regex.trim() : "",
        regex_message: showRegex ? regexMessage.trim() : "",
      };
      for (const k of ["tooltip", "hint", "regex", "regex_message"]) {
        if (!nextConfig[k]) delete nextConfig[k];
      }
      await fieldsApi.update(field.id, { config: nextConfig });

      // 2. placement (required + conditional rule) on the project's default-layout item
      const ruleVal: Rule | null =
        ruleOn && rule.field && rule.value.trim()
          ? { action: rule.action, field: rule.field, operator: rule.operator, value: rule.value.trim() }
          : null;
      if (item) {
        await layoutsApi.updateItem(item.id, { is_mandatory: required, visibility_rule: ruleVal });
      } else if (required || ruleVal) {
        const lay = layout ?? (await layoutsApi.create({ project: project.id, name: "Default Layout" }));
        await layoutsApi.createItem({
          layout: lay.id,
          field: field.id,
          sort_order: lay.items?.length ?? 0,
          section: "Details",
          is_mandatory: required,
          visibility_rule: ruleVal,
        });
      }

      toast.success("Field settings saved.");
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={Boolean(field)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Settings{field ? ` · ${field.name}` : ""}</SheetTitle>
          <SheetDescription>Basic and advanced configuration for this field.</SheetDescription>
        </SheetHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="flex-1 space-y-6 py-5">
            {/* Basic */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Basic</h3>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Required
                  <span className="block text-xs font-normal text-muted-foreground">
                    Mandatory on this project&apos;s form.
                  </span>
                </span>
                <Switch checked={required} disabled={!canEdit} onCheckedChange={setRequired} />
              </label>
              <FieldRow label="Tooltip" hint="Shown on hover / info icon next to the label.">
                <Input
                  value={tooltip}
                  disabled={!canEdit}
                  onChange={(e) => setTooltip(e.target.value)}
                  placeholder="e.g. A short summary of the issue"
                />
              </FieldRow>
              <FieldRow label="Hint text" hint="Helper text shown under or inside the input.">
                <Input
                  value={hint}
                  disabled={!canEdit}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="e.g. Keep it under 80 characters"
                />
              </FieldRow>
            </section>

            {/* Advanced (collapsed by default) */}
            <section className="space-y-4 border-t pt-5">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                aria-expanded={advancedOpen}
                className="flex w-full items-center gap-1.5 text-sm font-semibold"
              >
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
                Advanced
              </button>
              {advancedOpen ? (
                <div className="space-y-4">
              {showRegex ? (
                <>
                  <FieldRow label="Regex pattern" hint="Validates the value on submit (text fields).">
                    <Input
                      value={regex}
                      disabled={!canEdit}
                      onChange={(e) => setRegex(e.target.value)}
                      placeholder="e.g. ^INC-\\d+$"
                      className="font-mono"
                    />
                  </FieldRow>
                  <FieldRow label="Validation message" hint="Shown when the pattern doesn't match.">
                    <Input
                      value={regexMessage}
                      disabled={!canEdit}
                      onChange={(e) => setRegexMessage(e.target.value)}
                      placeholder="e.g. Must look like INC-123"
                    />
                  </FieldRow>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pattern validation applies to text fields only.
                </p>
              )}

              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Conditional rule
                    <span className="block text-xs font-normal text-muted-foreground">
                      Show or lock this field based on another field&apos;s value.
                    </span>
                  </span>
                  <Switch checked={ruleOn} disabled={!canEdit} onCheckedChange={setRuleOn} />
                </label>
                {ruleOn ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={rule.action}
                      onValueChange={(v) => setRule((r) => ({ ...r, action: v as Rule["action"] }))}
                    >
                      <SelectTrigger className="col-span-2" disabled={!canEdit}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="show">Show this field when…</SelectItem>
                        <SelectItem value="readonly">Make read-only when…</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={rule.field}
                      onValueChange={(v) => setRule((r) => ({ ...r, field: v }))}
                    >
                      <SelectTrigger disabled={!canEdit}>
                        <SelectValue placeholder="Field" />
                      </SelectTrigger>
                      <SelectContent>
                        {conditionFields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={rule.operator}
                      onValueChange={(v) => setRule((r) => ({ ...r, operator: v as Rule["operator"] }))}
                    >
                      <SelectTrigger disabled={!canEdit}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">is</SelectItem>
                        <SelectItem value="neq">is not</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={rule.value}
                      disabled={!canEdit}
                      onChange={(e) => setRule((r) => ({ ...r, value: e.target.value }))}
                      placeholder="value, e.g. on_hold"
                      className="col-span-2"
                    />
                    <p className="col-span-2 text-xs text-muted-foreground">
                      Enter the value/key of the condition field (e.g. status <code>on_hold</code>).
                    </p>
                  </div>
                ) : null}
              </div>

              {isGlobal ? (
                <p className="text-xs text-muted-foreground">
                  Tooltip, hint and pattern are shared for this standard field across all projects;
                  Required and the conditional rule apply only to this project.
                </p>
              ) : null}
                </div>
              ) : null}
            </section>
          </div>
        )}

        {canEdit ? (
          <div className="mt-auto flex justify-end border-t pt-4">
            <Button onClick={save} disabled={saving || loading} className="gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
