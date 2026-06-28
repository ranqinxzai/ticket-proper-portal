"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { fieldsApi, groupsApi, projectsApi, routingRulesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type {
  FieldDefinition,
  Group,
  Project,
  RoutingCondition,
  RoutingRule,
  UserRef,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { UserSearchCombobox } from "@/components/settings/user-search-combobox";

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const PRIORITIES = ["critical", "high", "medium", "low"] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A field a routing condition can match on, plus how to pick its value. */
type MatchField = {
  key: string;
  label: string;
  kind: "select" | "text";
  options?: { value: string; label: string }[];
};

// Value-backed custom field types worth routing on. Cascade/date/user/group/
// attachment/richtext are intentionally excluded (no clean scalar to match).
const SELECT_TYPES = ["dropdown", "radio", "multiselect"];
const TEXT_TYPES = ["text", "number"];

/** Build the routing match-field catalog: the two built-in attributes (Priority,
 *  Type) plus every value-backed custom field on the project (e.g. a "Location"
 *  dropdown). Column-backed system fields (config.maps_to) are skipped — they're
 *  either already covered (priority) or not part of the create-time value dict. */
function buildMatchFields(project: Project, defs: FieldDefinition[]): MatchField[] {
  const out: MatchField[] = [
    { key: "priority", label: "Priority", kind: "select", options: PRIORITIES.map((p) => ({ value: p, label: cap(p) })) },
    {
      key: "ticket_type",
      label: "Type",
      kind: "select",
      options: (project.ticket_types ?? []).map((t) => ({ value: t.id, label: t.name })),
    },
  ];
  for (const d of defs) {
    if ((d.config ?? {}).maps_to) continue; // column-backed → not in custom_fields
    if (SELECT_TYPES.includes(d.field_type)) {
      out.push({
        key: d.key,
        label: d.name,
        kind: "select",
        options: (d.options ?? [])
          .filter((o) => o.is_active)
          .map((o) => ({ value: o.value, label: o.label })),
      });
    } else if (TEXT_TYPES.includes(d.field_type)) {
      out.push({ key: d.key, label: d.name, kind: "text" });
    }
  }
  return out;
}

/** Human summary of a rule's conditions, e.g. "Location is Delhi · Priority is High". */
function describeRule(rule: RoutingRule, fields: MatchField[]): string {
  const conds = rule.match_spec?.conditions ?? [];
  if (conds.length === 0) return "Any ticket";
  const join = rule.match_spec?.match === "any" ? " or " : " and ";
  return conds
    .map((c) => {
      const f = fields.find((x) => x.key === c.field);
      const fieldLabel = f?.label ?? c.field;
      const valLabel = f?.options?.find((o) => o.value === c.value)?.label ?? c.value;
      const op = c.operator === "neq" ? "is not" : "is";
      return `${fieldLabel} ${op} ${valLabel}`;
    })
    .join(join);
}

// ── condition builder row ────────────────────────────────────────────────────

const EMPTY_CONDITION: RoutingCondition = { field: "", operator: "eq", value: "" };

function ConditionRow({
  fields,
  condition,
  onChange,
  onRemove,
}: {
  fields: MatchField[];
  condition: RoutingCondition;
  onChange: (next: RoutingCondition) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.key === condition.field);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={cn(selectCls, "w-auto min-w-[8rem] flex-1")}
        value={condition.field}
        aria-label="Condition field"
        onChange={(e) => onChange({ ...condition, field: e.target.value, value: "" })}
      >
        <option value="">Select field…</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        className={cn(selectCls, "w-auto")}
        value={condition.operator}
        aria-label="Condition operator"
        onChange={(e) => onChange({ ...condition, operator: e.target.value as "eq" | "neq" })}
      >
        <option value="eq">is</option>
        <option value="neq">is not</option>
      </select>
      {field?.kind === "select" ? (
        <select
          className={cn(selectCls, "w-auto min-w-[8rem] flex-1")}
          value={condition.value}
          aria-label="Condition value"
          disabled={!field}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        >
          <option value="">Select value…</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          className="h-9 w-auto min-w-[8rem] flex-1"
          value={condition.value}
          disabled={!field}
          placeholder="Value"
          aria-label="Condition value"
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Remove condition"
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ── create / edit dialog ─────────────────────────────────────────────────────

type DialogState = {
  open: boolean;
  editing: RoutingRule | null;
  name: string;
  matchAll: boolean;
  conditions: RoutingCondition[];
  targetGroup: string;
  targetAssignee: string | null;
  targetAssigneeLabel: string | null;
};

const CLOSED: DialogState = {
  open: false,
  editing: null,
  name: "",
  matchAll: true,
  conditions: [{ ...EMPTY_CONDITION }],
  targetGroup: "",
  targetAssignee: null,
  targetAssigneeLabel: null,
};

function RoutingRuleDialog({
  fields,
  groups,
  state,
  saving,
  onClose,
  onSubmit,
}: {
  fields: MatchField[];
  groups: Group[];
  state: DialogState;
  saving: boolean;
  onClose: () => void;
  onSubmit: (s: DialogState) => void;
}) {
  const [draft, setDraft] = useState<DialogState>(state);
  useEffect(() => {
    if (state.open) setDraft(state);
  }, [state]);

  const setConditions = (conditions: RoutingCondition[]) => setDraft((d) => ({ ...d, conditions }));

  const cleanConditions = draft.conditions.filter((c) => c.field && c.value !== "");
  const valid = draft.name.trim() && draft.targetGroup && cleanConditions.length > 0;

  // Drive open/close from the parent's state; `draft` only holds the editable
  // fields (re-synced from `state` each time the dialog opens).
  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state.editing ? "Edit routing rule" : "New routing rule"}</DialogTitle>
          <DialogDescription>
            When a new ticket matches the conditions, it lands on the chosen group (and optional
            technician) — unless an agent set a group at creation. Rules are evaluated top-to-bottom;
            the first match wins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rr-name">Name</Label>
            <Input
              id="rr-name"
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Delhi tickets → IT Delhi"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Conditions</span>
              <select
                className={cn(selectCls, "h-8 w-auto")}
                value={draft.matchAll ? "all" : "any"}
                aria-label="Match mode"
                onChange={(e) => setDraft((d) => ({ ...d, matchAll: e.target.value === "all" }))}
              >
                <option value="all">Match all</option>
                <option value="any">Match any</option>
              </select>
            </div>
            <div className="space-y-2">
              {draft.conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  fields={fields}
                  condition={c}
                  onChange={(next) => setConditions(draft.conditions.map((x, j) => (j === i ? next : x)))}
                  onRemove={() =>
                    setConditions(
                      draft.conditions.length === 1
                        ? [{ ...EMPTY_CONDITION }]
                        : draft.conditions.filter((_, j) => j !== i),
                    )
                  }
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConditions([...draft.conditions, { ...EMPTY_CONDITION }])}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add condition
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rr-group">Route to group</Label>
              <select
                id="rr-group"
                className={selectCls}
                value={draft.targetGroup}
                onChange={(e) => setDraft((d) => ({ ...d, targetGroup: e.target.value }))}
              >
                <option value="">Select a group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.helpdesk === null ? " (Shared)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Assign technician (optional)</Label>
              <UserSearchCombobox
                value={draft.targetAssigneeLabel}
                label={draft.targetAssigneeLabel}
                onSelect={(u: UserRef) =>
                  setDraft((d) => ({
                    ...d,
                    targetAssignee: String(u.id),
                    targetAssigneeLabel: u.full_name || u.username,
                  }))
                }
                onClear={() =>
                  setDraft((d) => ({ ...d, targetAssignee: null, targetAssigneeLabel: null }))
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid || saving} onClick={() => onSubmit(draft)}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── main editor ──────────────────────────────────────────────────────────────

/** Project settings → Routing tab. Two sections: (1) the assignment-group
 *  whitelist (empty ⇒ all groups allowed) and (2) create-time routing rules
 *  (e.g. Location = Delhi → IT Delhi). */
export function RoutingEditor({
  project,
  canEditWhitelist,
  canEditRules,
}: {
  project: Project;
  canEditWhitelist: boolean;
  canEditRules: boolean;
}) {
  const { refresh } = useWorkspace();

  const [groups, setGroups] = useState<Group[]>([]);
  const [defs, setDefs] = useState<FieldDefinition[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);

  // whitelist state
  const initialAllowed = project.allowed_group_ids ?? [];
  const [restrict, setRestrict] = useState<boolean>(initialAllowed.length > 0);
  const [allowed, setAllowed] = useState<Set<string>>(() => new Set(initialAllowed));
  const [savingWhitelist, setSavingWhitelist] = useState(false);

  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [savingRule, setSavingRule] = useState(false);

  const matchFields = useMemo(() => buildMatchFields(project, defs), [project, defs]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      groupsApi.list({ helpdesk: project.helpdesk, is_active: true }).catch(() => [] as Group[]),
      fieldsApi.list(project.id).catch(() => [] as FieldDefinition[]),
      routingRulesApi.list({ project: project.id }).catch(() => [] as RoutingRule[]),
    ])
      .then(([g, f, r]) => {
        setGroups(g);
        setDefs(f);
        setRules([...r].sort((a, b) => a.priority - b.priority));
      })
      .finally(() => setLoading(false));
  }, [project.helpdesk, project.id]);
  useEffect(() => load(), [load]);

  const toggleAllowed = (id: string) => {
    const next = new Set(allowed);
    next.has(id) ? next.delete(id) : next.add(id);
    setAllowed(next);
  };

  const saveWhitelist = async () => {
    // Empty list ⇒ all groups allowed. When restricting, fold in the default
    // group (always allowed) and require at least one group so tickets can land.
    let payload: string[] = [];
    if (restrict) {
      const set = new Set(allowed);
      if (project.default_group) set.add(project.default_group);
      payload = [...set];
      if (payload.length === 0) {
        toast.error("Select at least one group, or switch off the restriction.");
        return;
      }
    }
    setSavingWhitelist(true);
    try {
      await projectsApi.update(project.id, { allowed_group_ids: payload });
      toast.success("Assignment groups saved.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save assignment groups.");
    } finally {
      setSavingWhitelist(false);
    }
  };

  const openCreate = () => setDialog({ ...CLOSED, open: true });
  const openEdit = (r: RoutingRule) =>
    setDialog({
      open: true,
      editing: r,
      name: r.name,
      matchAll: r.match_spec?.match !== "any",
      conditions:
        (r.match_spec?.conditions ?? []).length > 0
          ? r.match_spec!.conditions!.map((c) => ({ ...c }))
          : [{ ...EMPTY_CONDITION }],
      targetGroup: r.target_group,
      targetAssignee: r.target_assignee ?? null,
      targetAssigneeLabel: r.target_assignee_name ?? null,
    });

  const submitRule = async (s: DialogState) => {
    const conditions = s.conditions.filter((c) => c.field && c.value !== "");
    const match_spec = { match: s.matchAll ? "all" : "any", conditions } as const;
    setSavingRule(true);
    try {
      if (s.editing) {
        await routingRulesApi.update(s.editing.id, {
          name: s.name.trim(),
          match_spec,
          target_group: s.targetGroup,
          target_assignee: s.targetAssignee,
        });
        toast.success("Rule updated.");
      } else {
        await routingRulesApi.create({
          project: project.id,
          name: s.name.trim(),
          priority: rules.length,
          match_spec,
          target_group: s.targetGroup,
          target_assignee: s.targetAssignee,
        });
        toast.success("Rule created.");
      }
      setDialog(CLOSED);
      load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the rule.");
    } finally {
      setSavingRule(false);
    }
  };

  const removeRule = async (r: RoutingRule) => {
    try {
      await routingRulesApi.delete(r.id);
      toast.success(`Deleted “${r.name}”`);
      load();
    } catch {
      toast.error("Could not delete the rule.");
    }
  };

  const toggleActive = async (r: RoutingRule) => {
    setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)));
    try {
      await routingRulesApi.update(r.id, { is_active: !r.is_active });
    } catch {
      toast.error("Could not update the rule.");
      load();
    }
  };

  const moveRule = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setRules(next);
    try {
      await Promise.all(
        next.map((r, i) => (r.priority === i ? Promise.resolve(null) : routingRulesApi.update(r.id, { priority: i }))),
      );
    } catch {
      toast.error("Could not reorder rules.");
      load();
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── Allowed assignment groups (whitelist) ───────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Allowed assignment groups</h3>
          <p className="text-sm text-muted-foreground">
            By default every group is available when assigning this project&apos;s tickets. Restrict it
            to a chosen set if only certain teams should own them.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={restrict}
            disabled={!canEditWhitelist}
            onChange={(e) => setRestrict(e.target.checked)}
          />
          Restrict to selected groups
        </label>
        {restrict && (
          <ul className="divide-y rounded-lg border">
            {groups.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No groups available."}
              </li>
            ) : (
              groups.map((g) => {
                const isDefault = project.default_group === g.id;
                const checked = isDefault || allowed.has(g.id);
                return (
                  <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      disabled={!canEditWhitelist || isDefault}
                      onChange={() => toggleAllowed(g.id)}
                      aria-label={`Allow ${g.name}`}
                    />
                    <span className={cn("flex-1 text-sm", !checked && "text-muted-foreground")}>
                      {g.name}
                      {g.helpdesk === null ? (
                        <span className="ml-2 text-xs text-muted-foreground">Shared</span>
                      ) : null}
                    </span>
                    {isDefault ? (
                      <span className="text-xs text-muted-foreground">Default · always allowed</span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        )}
        {canEditWhitelist && (
          <Button onClick={saveWhitelist} disabled={savingWhitelist}>
            {savingWhitelist ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save assignment groups
          </Button>
        )}
      </section>

      {/* ── Routing rules ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Routing rules</h3>
            <p className="text-sm text-muted-foreground">
              Auto-route new tickets to a group based on their field values (e.g. Location is Delhi →
              IT Delhi). Applied only when no group was chosen at creation; first match wins.
            </p>
          </div>
          {canEditRules && (
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New rule
            </Button>
          )}
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : rules.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No routing rules yet. New tickets land on the project&apos;s default group.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rules.map((r, idx) => {
              const target = groups.find((g) => g.id === r.target_group);
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      {!r.is_active && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          Off
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {describeRule(r, matchFields)} →{" "}
                      <span className="font-medium">{r.target_group_name ?? target?.name ?? "—"}</span>
                      {r.target_assignee_name ? ` · ${r.target_assignee_name}` : ""}
                    </p>
                  </div>
                  {canEditRules && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveRule(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${r.name} up`}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRule(idx, 1)}
                        disabled={idx === rules.length - 1}
                        aria-label={`Move ${r.name} down`}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={r.is_active}
                          onChange={() => toggleActive(r)}
                          aria-label={`Toggle ${r.name} active`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        aria-label={`Edit ${r.name}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRule(r)}
                        aria-label={`Delete ${r.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RoutingRuleDialog
        fields={matchFields}
        groups={groups}
        state={dialog}
        saving={savingRule}
        onClose={() => setDialog(CLOSED)}
        onSubmit={submitRule}
      />
    </div>
  );
}
