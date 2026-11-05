"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { automationRulesApi, cannedNotesApi, workflowsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { workspaceBase } from "@/lib/itsm/nav";
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCatalog,
  AutomationCatalogField,
  AutomationRule,
  AutomationRuleInput,
  AutomationRun,
  AutomationTrigger,
  CannedNote,
  FilterCondition,
  FilterFieldMeta,
  FilterMatch,
  FilterOperator,
  FilterValue,
  Project,
  WorkflowStatus,
  WorkflowTransition,
} from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Switch } from "@/components/ui/switch";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { CascadeSelect } from "@/components/tickets/cascade-select";
import { textareaCls } from "@/components/tickets/field-styles";
import { ConditionValue } from "@/components/tickets/filters/condition-value";
import { conditionSummary, isConditionComplete, operatorLabel } from "@/components/tickets/filters/filter-utils";
import { useFilterOptions } from "@/components/tickets/filters/use-filter-options";
import { AUTOMATION_HELP } from "@/lib/itsm/help/settings";

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const MAX_ACTIONS = 5;
const ACTION_LABEL: Record<AutomationActionType, string> = {
  transition: "Transition status",
  set_field: "Set field",
  add_comment: "Add comment",
};

type FilterOptions = ReturnType<typeof useFilterOptions>;

/** Everything the dialog + summaries need to turn ids into names. */
type Ctx = {
  catalog: AutomationCatalog | null;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
  cannedNotes: CannedNote[];
  options: FilterOptions;
};

// ── draft model (the dialog's local state) ───────────────────────────────────

type Draft = {
  name: string;
  description: string;
  isActive: boolean;
  stopProcessing: boolean;
  onCreated: boolean;
  onUpdated: boolean;
  updatedFields: string[];
  onStatusChanged: boolean;
  fromStatusIds: string[];
  toStatusIds: string[];
  match: FilterMatch;
  conditions: FilterCondition[];
  actions: AutomationAction[];
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  isActive: true,
  stopProcessing: false,
  onCreated: false,
  onUpdated: true,
  updatedFields: [],
  onStatusChanged: false,
  fromStatusIds: [],
  toStatusIds: [],
  match: "all",
  conditions: [],
  actions: [],
};

function draftFromRule(r: AutomationRule): Draft {
  const t = (type: AutomationTrigger["type"]) => r.triggers.find((x) => x.type === type);
  const upd = t("ticket_updated");
  const sc = t("status_changed");
  return {
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    stopProcessing: r.stop_processing,
    onCreated: !!t("ticket_created"),
    onUpdated: !!upd,
    updatedFields: upd?.type === "ticket_updated" ? upd.config.fields ?? [] : [],
    onStatusChanged: !!sc,
    fromStatusIds: sc?.type === "status_changed" ? sc.config.from_status_ids ?? [] : [],
    toStatusIds: sc?.type === "status_changed" ? sc.config.to_status_ids ?? [] : [],
    match: r.conditions?.match === "any" ? "any" : "all",
    conditions: (r.conditions?.conditions ?? []).map((c) => ({ ...c })),
    actions: r.actions.map((a) => ({ ...a, config: { ...a.config } }) as AutomationAction),
  };
}

/** The driving use case: an agent is assigned while the ticket is still New → run the
 *  workflow's New → Assigned transition, keeping the chosen agent. */
function templateDraft(statuses: WorkflowStatus[], transitions: WorkflowTransition[]): Draft {
  const initial = statuses.find((s) => s.is_initial);
  const tr =
    transitions.find((t) => t.from_status === initial?.id && t.to_status_key === "assigned") ??
    transitions.find((t) => t.from_status === initial?.id);
  return {
    ...EMPTY_DRAFT,
    name: "Move to Assigned when an agent is assigned",
    onCreated: true,
    onUpdated: true,
    updatedFields: ["assignee"],
    conditions: [
      ...(initial ? [{ field: "status", op: "eq" as FilterOperator, value: initial.id }] : []),
      { field: "assignee", op: "is_not_empty" as FilterOperator },
    ],
    actions: tr ? [{ type: "transition", config: { transition_id: tr.id, keep_assignee: true } }] : [],
  };
}

function draftToInput(d: Draft): AutomationRuleInput {
  const triggers: AutomationTrigger[] = [];
  if (d.onCreated) triggers.push({ type: "ticket_created", config: {} });
  if (d.onUpdated) triggers.push({ type: "ticket_updated", config: { fields: d.updatedFields } });
  if (d.onStatusChanged)
    triggers.push({
      type: "status_changed",
      config: { from_status_ids: d.fromStatusIds, to_status_ids: d.toStatusIds },
    });
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    is_active: d.isActive,
    stop_processing: d.stopProcessing,
    triggers,
    conditions: d.conditions.length ? { match: d.match, conditions: d.conditions } : {},
    actions: d.actions,
  };
}

function isEmptyValue(v: FilterValue | undefined): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function actionIncomplete(a: AutomationAction): string | null {
  if (a.type === "transition") return a.config.transition_id ? null : "Pick a transition.";
  if (a.type === "set_field") {
    if (!a.config.field) return "Pick the field to set.";
    const needsValue = a.config.field !== "assignee";
    return needsValue && isEmptyValue(a.config.value) ? "Pick the value to set." : null;
  }
  if (a.type === "add_comment") {
    const text = (a.config.body_html ?? "").replace(/<[^>]*>/g, "").trim();
    return a.config.canned_note_id || text ? null : "Write the comment or pick a canned response.";
  }
  return null;
}

function invalidReason(d: Draft): string | null {
  if (!d.name.trim()) return "Give the rule a name.";
  if (!d.onCreated && !d.onUpdated && !d.onStatusChanged) return "Pick at least one trigger.";
  if (d.conditions.some((c) => !isConditionComplete(c))) return "Finish or remove the incomplete condition.";
  if (d.actions.length === 0) return "Add at least one action.";
  for (const a of d.actions) {
    const why = actionIncomplete(a);
    if (why) return why;
  }
  return null;
}

// ── summaries ───────────────────────────────────────────────────────────────

function statusName(ctx: Ctx, id: string) {
  return ctx.statuses.find((s) => s.id === id)?.name ?? "a removed status";
}

function transitionLabel(ctx: Ctx, t: WorkflowTransition) {
  const from = t.is_global ? "any status" : t.from_status ? statusName(ctx, t.from_status) : "(create)";
  return `${t.name} (${from} → ${statusName(ctx, t.to_status)})`;
}

function catalogLabel(list: AutomationCatalogField[] | undefined, key: string) {
  return list?.find((f) => f.key === key)?.label ?? key;
}

function describeTriggers(r: AutomationRule, ctx: Ctx): string {
  return r.triggers
    .map((t) => {
      if (t.type === "ticket_created") return "created";
      if (t.type === "ticket_updated") {
        const f = t.config.fields ?? [];
        return f.length
          ? `${f.map((k) => catalogLabel(ctx.catalog?.update_fields, k)).join(" / ")} changed`
          : "any field changed";
      }
      const to = t.config.to_status_ids ?? [];
      return to.length ? `moved to ${to.map((id) => statusName(ctx, id)).join(" / ")}` : "status changed";
    })
    .join(" or ");
}

function describeValue(ctx: Ctx, rule: AutomationRule, field: string, value: FilterValue): string {
  const entry = ctx.catalog?.set_fields.find((f) => f.key === field);
  const meta = entry?.filter_key ? ctx.options.fieldByKey(entry.filter_key) : undefined;
  if (isEmptyValue(value)) return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (entry?.cascade && Array.isArray(value)) {
    const label = new Map(entry.cascade.options.map((o) => [o.value, o.label]));
    return value.map((v) => label.get(String(v)) ?? String(v)).join(" › ");
  }
  const one = (s: string) => {
    if (rule.user_labels?.[s] && (meta?.type === "user" || field === "assignee")) return rule.user_labels[s];
    const text = (meta && ctx.options.labelFor(meta.key, s)) ?? s;
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  };
  return Array.isArray(value) ? value.map((v) => one(String(v))).join(", ") : one(String(value));
}

function describeAction(a: AutomationAction, ctx: Ctx, rule: AutomationRule): string {
  if (a.type === "transition") {
    const t = ctx.transitions.find((x) => x.id === a.config.transition_id);
    return t ? `run “${t.name}”` : "run a removed transition";
  }
  if (a.type === "set_field") {
    const label = catalogLabel(ctx.catalog?.set_fields, a.config.field);
    return `set ${label} to ${describeValue(ctx, rule, a.config.field, a.config.value)}`;
  }
  return a.config.visibility === "public" ? "add a public comment" : "add an internal note";
}

function describeRule(r: AutomationRule, ctx: Ctx): string {
  const conds = r.conditions?.conditions ?? [];
  const when = `When ${describeTriggers(r, ctx)}`;
  const ifs = conds.length
    ? ` · if ${conds
        .map((c) => {
          const meta = ctx.options.fieldByKey(c.field);
          return meta ? `${meta.label} ${conditionSummary(c, meta, ctx.options.labelFor)}` : c.field;
        })
        .join(r.conditions?.match === "any" ? " or " : " and ")}`
    : "";
  const then = ` · then ${r.actions.map((a) => describeAction(a, ctx, r)).join(", ")}`;
  return when + ifs + then;
}

function when(iso: string | null) {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// ── editor (the tab) ────────────────────────────────────────────────────────

export function AutomationEditor({
  project,
  canView,
  canEdit,
}: {
  project: Project;
  canView: boolean;
  canEdit: boolean;
}) {
  const options = useFilterOptions(project);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null);
  const [transitions, setTransitions] = useState<WorkflowTransition[]>([]);
  const [cannedNotes, setCannedNotes] = useState<CannedNote[]>([]);
  const [loading, setLoading] = useState(true);
  // Dialog: `key` remounts the form so its local draft is re-seeded per open.
  const [dialog, setDialog] = useState<{ key: string; editing: AutomationRule | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [runsFor, setRunsFor] = useState<AutomationRule | null>(null);

  const ctx: Ctx = useMemo(
    () => ({ catalog, statuses: options.statuses, transitions, cannedNotes, options }),
    [catalog, options, transitions, cannedNotes],
  );

  const { registerUserLabel } = options;
  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [r, c, trs, notes] = await Promise.all([
        automationRulesApi.list({ project: project.id }),
        automationRulesApi.catalog(project.id),
        project.default_workflow
          ? workflowsApi.transitions(project.default_workflow).catch(() => [] as WorkflowTransition[])
          : Promise.resolve([] as WorkflowTransition[]),
        cannedNotesApi.list({ helpdesk: project.helpdesk }).catch(() => [] as CannedNote[]),
      ]);
      const sorted = [...r].sort((a, b) => a.order - b.order);
      sorted.forEach((rule) =>
        Object.entries(rule.user_labels ?? {}).forEach(([id, name]) => registerUserLabel(id, name)),
      );
      setRules(sorted);
      setCatalog(c);
      setTransitions(trs);
      setCannedNotes(notes.filter((n) => n.is_shared));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not load automation rules.");
    } finally {
      setLoading(false);
    }
  }, [canView, project.id, project.default_workflow, project.helpdesk, registerUserLabel]);
  useEffect(() => {
    void load();
  }, [load]);

  const openNew = (draft: Draft = EMPTY_DRAFT) =>
    setDialog({ key: `new-${Date.now()}`, editing: null, draft });
  const openEdit = (r: AutomationRule) =>
    setDialog({ key: `${r.id}-${r.updated_at}`, editing: r, draft: draftFromRule(r) });

  const save = async (d: Draft) => {
    setSaving(true);
    try {
      const body = draftToInput(d);
      if (dialog?.editing) {
        await automationRulesApi.update(dialog.editing.id, body);
        toast.success("Rule updated.");
      } else {
        const nextOrder = rules.length ? Math.max(...rules.map((r) => r.order)) + 1 : 1;
        await automationRulesApi.create({ ...body, project: project.id, order: nextOrder });
        toast.success("Rule created.");
      }
      setDialog(null);
      void load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the rule.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: AutomationRule) => {
    if (!window.confirm(`Delete the rule “${r.name}”? This can't be undone.`)) return;
    try {
      await automationRulesApi.delete(r.id);
      toast.success(`Deleted “${r.name}”.`);
      void load();
    } catch {
      toast.error("Could not delete the rule.");
    }
  };

  const toggleActive = async (r: AutomationRule) => {
    setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)));
    try {
      await automationRulesApi.update(r.id, { is_active: !r.is_active });
    } catch {
      toast.error("Could not update the rule.");
      void load();
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setRules(next);
    try {
      await Promise.all(
        next.map((r, i) => (r.order === i + 1 ? null : automationRulesApi.update(r.id, { order: i + 1 }))),
      );
    } catch {
      toast.error("Could not reorder rules.");
    }
    void load();
  };

  if (!canView) {
    return <ReadOnlyBanner message="You don't have permission to view this project's automation rules." />;
  }

  return (
    <div className="max-w-4xl space-y-4 compact:space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Automation rules</h3>
          <p className="text-sm text-muted-foreground">
            When something happens to a ticket in this project, check conditions and act automatically
            — move its status, set a field or add a comment.
            <InfoTip label="How automation rules run" className="ml-[-1px]">
              {`${AUTOMATION_HELP.order} ${AUTOMATION_HELP.noChain} ${AUTOMATION_HELP.runAs}`}
            </InfoTip>
          </p>
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openNew(templateDraft(options.statuses, transitions))}
              disabled={loading}>
              <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Use template
            </Button>
            <Button size="sm" onClick={() => openNew()} disabled={loading}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New rule
            </Button>
          </div>
        ) : null}
      </div>
      {!canEdit ? (
        <ReadOnlyBanner message="View only: changing automation rules needs permission to edit projects." />
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <Zap className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No automation rules yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Start from the template: when an agent is assigned to a New ticket, move it to Assigned
            automatically.
          </p>
          {canEdit ? (
            <Button size="sm" className="mt-3" onClick={() => openNew(templateDraft(options.statuses, transitions))}>
              <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Move to Assigned when an agent is assigned
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rules.map((r, idx) => {
            const summary = describeRule(r, ctx);
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium" title={r.name}>{r.name}</span>
                    {!r.is_active ? (
                      <Hint label={AUTOMATION_HELP.off}>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          Off
                        </span>
                      </Hint>
                    ) : null}
                    {r.stop_processing ? (
                      <Hint label={AUTOMATION_HELP.stop}>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          Stops
                        </span>
                      </Hint>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={summary}>{summary}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Ran {r.run_count}× · last {when(r.last_run_at)}
                    {r.failure_count > 0 ? (
                      <span className="text-destructive"> · {r.failure_count} failed</span>
                    ) : null}
                  </p>
                </div>
                <IconButton
                  label={`Recent runs of ${r.name}`}
                  detail={AUTOMATION_HELP.runs}
                  onClick={() => setRunsFor(r)}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                {canEdit ? (
                  <>
                    <IconButton
                      label={`Move ${r.name} up`}
                      detail={AUTOMATION_HELP.order}
                      disabledReason="Already first"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Move ${r.name} down`}
                      detail={AUTOMATION_HELP.order}
                      disabledReason="Already last"
                      onClick={() => move(idx, 1)}
                      disabled={idx === rules.length - 1}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                    <Hint label={r.is_active ? `Turn ${r.name} off` : `Turn ${r.name} on`}>
                      <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)}
                        aria-label={`${r.name} active`} />
                    </Hint>
                    <IconButton
                      label={`Edit ${r.name}`}
                      onClick={() => openEdit(r)}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Delete ${r.name}`}
                      onClick={() => remove(r)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {dialog ? (
        <RuleDialog
          key={dialog.key}
          initial={dialog.draft}
          editing={!!dialog.editing}
          ctx={ctx}
          saving={saving}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      ) : null}
      <RunsDialog rule={runsFor} project={project} onClose={() => setRunsFor(null)} />
    </div>
  );
}

// ── rule dialog ─────────────────────────────────────────────────────────────

function RuleDialog({
  initial,
  editing,
  ctx,
  saving,
  onClose,
  onSave,
}: {
  initial: Draft;
  editing: boolean;
  ctx: Ctx;
  saving: boolean;
  onClose: () => void;
  onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const patch = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const why = invalidReason(d);
  // "project" is fixed (the rule's own); hide it from the condition field picker.
  const condFields = ctx.options.fields.filter((f) => f.key !== "project");

  const setCondition = (i: number, c: FilterCondition) =>
    patch({ conditions: d.conditions.map((x, j) => (j === i ? c : x)) });
  const setAction = (i: number, a: AutomationAction) =>
    patch({ actions: d.actions.map((x, j) => (j === i ? a : x)) });

  const addAction = (type: AutomationActionType) => {
    const a: AutomationAction =
      type === "transition"
        ? { type, config: { transition_id: "", keep_assignee: true } }
        : type === "set_field"
          ? { type, config: { field: "", value: null } }
          : { type, config: { body_html: "", visibility: "private" } };
    patch({ actions: [...d.actions, a] });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit automation rule" : "New automation rule"}</DialogTitle>
          <DialogDescription>When the trigger fires and the conditions match, the actions run.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="auto-name">Name</Label>
              <Input id="auto-name" value={d.name} onChange={(e) => patch({ name: e.target.value })}
                placeholder="e.g. Move to Assigned when an agent is assigned" />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch checked={d.isActive} onCheckedChange={(v) => patch({ isActive: v })} aria-label="Rule active" />
              Active
            </label>
          </div>

          {/* WHEN */}
          <section className="space-y-2 rounded-lg border p-3">
            <h4 className="flex items-center text-sm font-semibold">
              When
              <InfoTip label="About triggers">{AUTOMATION_HELP.triggers}</InfoTip>
            </h4>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={d.onCreated} onCheckedChange={(v) => patch({ onCreated: v === true })}
                aria-label="Ticket created" />
              Ticket created
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={d.onUpdated} onCheckedChange={(v) => patch({ onUpdated: v === true })}
                  aria-label="Field updated" />
                A field is updated
                <InfoTip label="About the field-updated trigger">{AUTOMATION_HELP.updated}</InfoTip>
              </label>
              {d.onUpdated ? (
                <FieldChecklist
                  fields={ctx.catalog?.update_fields ?? []}
                  selected={d.updatedFields}
                  onChange={(updatedFields) => patch({ updatedFields })}
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={d.onStatusChanged}
                  onCheckedChange={(v) => patch({ onStatusChanged: v === true })} aria-label="Status changed" />
                Status changes
                <InfoTip label="About the status-changed trigger">{AUTOMATION_HELP.statusChanged}</InfoTip>
              </label>
              {d.onStatusChanged ? (
                <div className="grid gap-3 pl-6 sm:grid-cols-2">
                  <StatusMultiPick label="From (any if none)" statuses={ctx.statuses} selected={d.fromStatusIds}
                    onChange={(fromStatusIds) => patch({ fromStatusIds })} />
                  <StatusMultiPick label="To (any if none)" statuses={ctx.statuses} selected={d.toStatusIds}
                    onChange={(toStatusIds) => patch({ toStatusIds })} />
                </div>
              ) : null}
            </div>
          </section>

          {/* IF */}
          <section className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center text-sm font-semibold">
                If
                <InfoTip label="About conditions">{AUTOMATION_HELP.conditions}</InfoTip>
              </h4>
              {d.conditions.length > 1 ? (
                <select className={cn(selectCls, "h-8 w-auto")} aria-label="Match mode" value={d.match}
                  onChange={(e) => patch({ match: e.target.value as FilterMatch })}>
                  <option value="all">Match all conditions</option>
                  <option value="any">Match any condition</option>
                </select>
              ) : null}
            </div>
            {d.conditions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conditions: the rule runs every time it triggers.</p>
            ) : (
              <ul className="space-y-2">
                {d.conditions.map((c, i) => (
                  <ConditionRow key={i} condition={c} fields={condFields} options={ctx.options}
                    onChange={(nc) => setCondition(i, nc)}
                    onRemove={() => patch({ conditions: d.conditions.filter((_, j) => j !== i) })} />
                ))}
              </ul>
            )}
            <Button type="button" size="sm" variant="outline" disabled={condFields.length === 0}
              onClick={() => patch({ conditions: [...d.conditions, { field: "status", op: "eq", value: "" }] })}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add condition
            </Button>
          </section>

          {/* THEN */}
          <section className="space-y-2 rounded-lg border p-3">
            <h4 className="flex items-center text-sm font-semibold">
              Then
              <InfoTip label="How actions run">{AUTOMATION_HELP.allOrNothing}</InfoTip>
            </h4>
            {d.actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add what the rule should do.</p>
            ) : (
              <ol className="space-y-2">
                {d.actions.map((a, i) => (
                  <ActionCard key={i} index={i} action={a} ctx={ctx} onChange={(na) => setAction(i, na)}
                    onRemove={() => patch({ actions: d.actions.filter((_, j) => j !== i) })} />
                ))}
              </ol>
            )}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACTION_LABEL) as AutomationActionType[]).map((t) => (
                <Hint key={t} label={d.actions.length >= MAX_ACTIONS ? `A rule can have at most ${MAX_ACTIONS} actions` : ""}>
                  <Button type="button" size="sm" variant="outline" disabled={d.actions.length >= MAX_ACTIONS}
                    onClick={() => addAction(t)}>
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {ACTION_LABEL[t]}
                  </Button>
                </Hint>
              ))}
            </div>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={d.stopProcessing} onCheckedChange={(v) => patch({ stopProcessing: v === true })}
              aria-label="Stop after this rule" />
            Stop after this rule
            <InfoTip label="About stop after this rule">{AUTOMATION_HELP.stop}</InfoTip>
          </label>
        </div>

        <DialogFooter className="items-center gap-2">
          {why ? <p className="mr-auto text-xs text-muted-foreground">{why}</p> : null}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Hint label={why ?? ""}>
            <Button onClick={() => onSave(d)} disabled={!!why || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {editing ? "Save rule" : "Create rule"}
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldChecklist({
  fields,
  selected,
  onChange,
}: {
  fields: AutomationCatalogField[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (k: string) =>
    onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <div className="pl-6">
      <p className="mb-1 text-xs text-muted-foreground">
        {selected.length ? "Fires when any ticked field changes." : "Nothing ticked: fires on any field change."}
      </p>
      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-auto">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={selected.includes(f.key)} onCheckedChange={() => toggle(f.key)} aria-label={f.label} />
            {f.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function StatusMultiPick({
  label,
  statuses,
  selected,
  onChange,
}: {
  label: string;
  statuses: WorkflowStatus[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      {statuses.map((s) => (
        <label key={s.id} className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} aria-label={s.name} />
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          {s.name}
        </label>
      ))}
    </fieldset>
  );
}

function ConditionRow({
  condition,
  fields,
  options,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  fields: FilterFieldMeta[];
  options: FilterOptions;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const meta = options.fieldByKey(condition.field);
  const ops = meta?.operators ?? [];
  return (
    <li className="grid items-start gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,10rem)_1fr_auto]">
      <select className={selectCls} aria-label="Condition field" value={condition.field}
        onChange={(e) => {
          const next = options.fieldByKey(e.target.value);
          onChange({ field: e.target.value, op: (next?.operators[0] ?? "eq") as FilterOperator, value: "" });
        }}>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>
      <select className={selectCls} aria-label="Condition operator" value={condition.op}
        onChange={(e) => onChange({ ...condition, op: e.target.value as FilterOperator, value: "" })}>
        {ops.map((op) => (
          <option key={op} value={op}>{operatorLabel(op)}</option>
        ))}
      </select>
      <div className="min-w-0">
        {meta ? (
          <ConditionValue field={meta} condition={condition} options={options.optionsForField(meta)}
            labelFor={options.labelFor} registerUserLabel={options.registerUserLabel} allowMe={false}
            onChange={(value) => onChange({ ...condition, value })} />
        ) : (
          <p className="pt-2 text-xs text-muted-foreground">This field is no longer on the project.</p>
        )}
      </div>
      <IconButton label="Remove condition" onClick={onRemove}
        className="h-9 w-9 text-muted-foreground hover:text-destructive">
        <X className="h-4 w-4" aria-hidden="true" />
      </IconButton>
    </li>
  );
}

function ActionCard({
  index,
  action,
  ctx,
  onChange,
  onRemove,
}: {
  index: number;
  action: AutomationAction;
  ctx: Ctx;
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {index + 1}. {ACTION_LABEL[action.type]}
        </span>
        <IconButton label={`Remove action ${index + 1}`} onClick={onRemove}
          className="h-7 w-7 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
      {action.type === "transition" ? (
        <TransitionActionFields action={action} ctx={ctx} onChange={onChange} />
      ) : action.type === "set_field" ? (
        <SetFieldActionFields action={action} ctx={ctx} onChange={onChange} />
      ) : (
        <CommentActionFields action={action} ctx={ctx} onChange={onChange} />
      )}
    </li>
  );
}

function TransitionActionFields({
  action,
  ctx,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "transition" }>;
  ctx: Ctx;
  onChange: (a: AutomationAction) => void;
}) {
  // The "(create)" transition never runs on an existing ticket (the backend rejects it).
  const runnable = ctx.transitions.filter((t) => t.from_status !== null || t.is_global);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <select className={selectCls} aria-label="Transition to run" value={action.config.transition_id}
          onChange={(e) => onChange({ ...action, config: { ...action.config, transition_id: e.target.value } })}>
          <option value="" disabled>Pick a transition…</option>
          {runnable.map((t) => (
            <option key={t.id} value={t.id}>{transitionLabel(ctx, t)}</option>
          ))}
        </select>
        <InfoTip label="How the transition runs">{AUTOMATION_HELP.transition}</InfoTip>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={action.config.keep_assignee}
          onCheckedChange={(v) => onChange({ ...action, config: { ...action.config, keep_assignee: v === true } })}
          aria-label="Keep the current assignee" />
        Keep the current assignee
        <InfoTip label="About keeping the assignee">{AUTOMATION_HELP.keepAssignee}</InfoTip>
      </label>
    </div>
  );
}

function SetFieldActionFields({
  action,
  ctx,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "set_field" }>;
  ctx: Ctx;
  onChange: (a: AutomationAction) => void;
}) {
  const fields = ctx.catalog?.set_fields ?? [];
  const metaOf = (f?: AutomationCatalogField) => (f?.filter_key ? ctx.options.fieldByKey(f.filter_key) : undefined);
  const entry = fields.find((f) => f.key === action.config.field);
  const meta = metaOf(entry);
  const value = action.config.value;
  const setValue = (next: FilterValue) => onChange({ ...action, config: { ...action.config, value: next } });
  const pickField = (key: string) => {
    // A checkbox starts unticked (a real value), so "set to No" needs no extra click.
    const isBool = metaOf(fields.find((f) => f.key === key))?.type === "boolean";
    onChange({ ...action, config: { field: key, value: isBool ? false : null } });
  };
  return (
    <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
      <div className="flex items-center gap-1">
        <select className={selectCls} aria-label="Field to set" value={action.config.field}
          onChange={(e) => pickField(e.target.value)}>
          <option value="" disabled>Pick a field…</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <InfoTip label="Which fields can be set?">{AUTOMATION_HELP.setField}</InfoTip>
      </div>
      <div className="min-w-0 space-y-1">
        {!entry ? null : entry.cascade ? (
          <CascadeSelect levels={entry.cascade.levels} options={entry.cascade.options}
            value={Array.isArray(value) ? value.map(String) : []} onChange={setValue} />
        ) : entry.field_type === "group_picker" && meta ? (
          // One group (the ticket form's group picker is single-choice).
          <select className={selectCls} aria-label={entry.label}
            value={Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}>
            <option value="" disabled>Select…</option>
            {ctx.options.optionsForField(meta).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : entry.field_type === "multiline" ? (
          <textarea className={textareaCls} rows={3} aria-label={entry.label} value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)} />
        ) : meta?.type === "boolean" ? (
          <label className="flex items-center gap-2 pt-2 text-sm">
            <Checkbox checked={value === true} onCheckedChange={(v) => setValue(v === true)}
              aria-label={entry.label} />
            {entry.label}
          </label>
        ) : meta ? (
          <ConditionValue field={meta} condition={{ field: meta.key, op: "eq", value: value ?? "" }}
            options={ctx.options.optionsForField(meta)} labelFor={ctx.options.labelFor}
            registerUserLabel={ctx.options.registerUserLabel} allowMe={false} onChange={setValue} />
        ) : (
          <Input aria-label={entry.label} value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)} />
        )}
        {entry?.key === "assignee" ? (
          <p className="text-xs text-muted-foreground">
            Leave empty to unassign. The person must be a member of the ticket&apos;s group.
            {value ? (
              <button type="button" className="ml-1 underline" onClick={() => setValue(null)}>Clear</button>
            ) : null}
          </p>
        ) : null}
        {entry?.key === "assigned_group" ? (
          <p className="text-xs text-muted-foreground">{AUTOMATION_HELP.setGroup}</p>
        ) : null}
        {entry?.key === "impact" || entry?.key === "urgency" ? (
          <p className="text-xs text-muted-foreground">{AUTOMATION_HELP.setImpactUrgency}</p>
        ) : null}
      </div>
    </div>
  );
}

function CommentActionFields({
  action,
  ctx,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "add_comment" }>;
  ctx: Ctx;
  onChange: (a: AutomationAction) => void;
}) {
  const cfg = action.config;
  const set = (p: Partial<typeof cfg>) => onChange({ ...action, config: { ...cfg, ...p } });
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-1">
          <select className={selectCls} aria-label="Comment visibility" value={cfg.visibility}
            onChange={(e) => set({ visibility: e.target.value as "public" | "private" })}>
            <option value="private">Internal note (agents only)</option>
            <option value="public">Public comment (emails the requestor)</option>
          </select>
          {cfg.visibility === "public" ? (
            <InfoTip label="About public automated comments">{AUTOMATION_HELP.publicComment}</InfoTip>
          ) : null}
        </div>
        <select className={selectCls} aria-label="Comment source" value={cfg.canned_note_id ?? ""}
          onChange={(e) => set({ canned_note_id: e.target.value || undefined })}>
          <option value="">Write the text below</option>
          {ctx.cannedNotes.map((n) => (
            <option key={n.id} value={n.id}>Canned: {n.title}</option>
          ))}
        </select>
      </div>
      {cfg.canned_note_id ? (
        <p className="text-xs text-muted-foreground">
          Uses the canned response&apos;s current text each time the rule runs.
        </p>
      ) : (
        <RichTextEditor value={cfg.body_html ?? ""} onChange={(html) => set({ body_html: html })}
          ariaLabel="Comment text" minHeight={90} placeholder="Comment text…" />
      )}
    </div>
  );
}

// ── recent runs ─────────────────────────────────────────────────────────────

const RUN_BADGE: Record<AutomationRun["status"], string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  skipped: "bg-muted text-muted-foreground",
};
const EVENT_LABEL: Record<AutomationRun["event"], string> = {
  ticket_created: "created",
  ticket_updated: "updated",
  status_changed: "status changed",
};

function RunsDialog({
  rule,
  project,
  onClose,
}: {
  rule: AutomationRule | null;
  project: Project;
  onClose: () => void;
}) {
  const { org } = useParams<{ org: string }>();
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  useEffect(() => {
    if (!rule) return;
    setRuns(null);
    automationRulesApi
      .runs(rule.id)
      .then(setRuns)
      .catch(() => {
        setRuns([]);
        toast.error("Could not load the rule's runs.");
      });
  }, [rule]);
  return (
    <Dialog open={!!rule} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recent runs — {rule?.name}</DialogTitle>
          <DialogDescription>{AUTOMATION_HELP.runs}</DialogDescription>
        </DialogHeader>
        {runs === null ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        ) : runs.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            This rule hasn&apos;t matched any ticket yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {runs.map((run) => (
              <li key={run.id} className="flex items-start gap-3 px-3 py-2">
                <span className={cn("mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", RUN_BADGE[run.status])}>
                  {run.status}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <Link className="font-mono text-xs font-medium text-primary hover:underline"
                      href={`${workspaceBase(org, project.helpdesk_key)}/p/${project.key}/${run.ticket_number}`}>
                      {run.ticket_number}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {EVENT_LABEL[run.event] ?? run.event} · {when(run.created_at)}
                    </span>
                  </div>
                  {run.message ? <p className="break-words text-xs text-muted-foreground">{run.message}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

