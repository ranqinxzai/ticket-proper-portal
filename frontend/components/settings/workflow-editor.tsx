"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Plus, ShieldCheck, SlidersHorizontal, Trash2, X, XCircle } from "lucide-react";

import { approvalWorkflowsApi, fieldsApi, projectsApi, workflowsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type {
  ApprovalWorkflow,
  FieldDefinition,
  Project,
  TransitionFieldCondition,
  TransitionFieldConditionOperator,
  TransitionNoteVisibility,
  TransitionScreenFieldConfig,
  WorkflowGraph,
  WorkflowStatus,
  WorkflowStatusCategory,
  WorkflowTransition,
  WorkflowValidation,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { CreateWorkflowDialog } from "./create-workflow-dialog";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

export function WorkflowEditor({
  project,
  canEdit,
  canLinkProject = false,
}: {
  project: Project;
  canEdit: boolean;
  canLinkProject?: boolean;
}) {
  const { refresh } = useWorkspace();
  const workflowId = project.default_workflow ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [categories, setCategories] = useState<WorkflowStatusCategory[]>([]);
  const [approvalWorkflows, setApprovalWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowValidation | null>(null);

  // status form
  const [statusName, setStatusName] = useState("");
  const [statusCat, setStatusCat] = useState("");
  const [statusPausesSla, setStatusPausesSla] = useState(false);
  // transition form
  const [transName, setTransName] = useState("");
  const [fromStatus, setFromStatus] = useState("__create__");
  const [toStatus, setToStatus] = useState("");
  // transition whose note-prompt config dialog is open
  const [configTransition, setConfigTransition] = useState<WorkflowTransition | null>(null);
  // status whose settings ("Exclude from SLA") dialog is open
  const [configStatus, setConfigStatus] = useState<WorkflowStatus | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [g, cats] = await Promise.all([workflowsApi.graph(workflowId), workflowsApi.categories()]);
      setGraph(g);
      setCategories(cats);
      if (cats[0]) setStatusCat((c) => c || cats[0].id);
    } catch {
      setGraph(null);
    } finally {
      setLoading(false);
    }
    // Approval rules for the Start-approval picker — best-effort; an empty list just
    // renders the "create one in the Approval tab" hint, so failures are non-fatal.
    try {
      setApprovalWorkflows(await approvalWorkflowsApi.list({ project: project.id }));
    } catch {
      setApprovalWorkflows([]);
    }
  }, [workflowId, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!workflowId || !statusName.trim() || !statusCat) return;
    setBusy("status");
    try {
      await workflowsApi.createStatus({
        workflow: workflowId,
        name: statusName.trim(),
        key: slugify(statusName),
        category: statusCat,
        color: "#64748b",
        sort_order: graph?.statuses.length ?? 0,
        pauses_sla: statusPausesSla,
      });
      setStatusName("");
      setStatusPausesSla(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the status.");
    } finally {
      setBusy(null);
    }
  }

  async function removeStatus(id: string) {
    setBusy(id);
    try {
      await workflowsApi.deleteStatus(id);
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the status.");
    } finally {
      setBusy(null);
    }
  }

  async function addTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!workflowId || !transName.trim() || !toStatus) return;
    setBusy("transition");
    try {
      await workflowsApi.createTransition({
        workflow: workflowId,
        name: transName.trim(),
        from_status: fromStatus === "__create__" ? null : fromStatus,
        to_status: toStatus,
        sort_order: graph?.transitions.length ?? 0,
      });
      setTransName("");
      setToStatus("");
      setFromStatus("__create__");
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the transition.");
    } finally {
      setBusy(null);
    }
  }

  async function removeTransition(id: string) {
    setBusy(id);
    try {
      await workflowsApi.deleteTransition(id);
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the transition.");
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    if (!workflowId) return;
    setBusy("validate");
    try {
      setResult(await workflowsApi.validate(workflowId));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not validate.");
    } finally {
      setBusy(null);
    }
  }

  async function linkWorkflow(workflow: { id: string }) {
    await projectsApi.update(project.id, { default_workflow: workflow.id });
    await refresh();
  }

  if (!workflowId) {
    const canCreate = canEdit && canLinkProject;
    return (
      <div className="max-w-xl space-y-3 rounded-lg border border-dashed px-5 py-6">
        <p className="text-sm font-medium text-foreground">No workflow assigned yet</p>
        <p className="text-sm text-muted-foreground">
          This project has no workflow, so tickets can&rsquo;t move through statuses.{" "}
          {canCreate
            ? "Create one to get started, or pick an existing one as the Default workflow on the Overview tab."
            : "Set a Default workflow on the Overview tab, or ask an admin to create one."}
        </p>
        {canCreate ? (
          <>
            <Button className="gap-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create workflow
            </Button>
            <CreateWorkflowDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              defaultName={`${project.name} Workflow`}
              baseType={project.project_type}
              onCreated={linkWorkflow}
            />
          </>
        ) : null}
      </div>
    );
  }
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workflow…
      </p>
    );
  }
  if (!graph) {
    return <p className="text-sm text-muted-foreground">Could not load the workflow.</p>;
  }

  const statusName_ = (id: string | null) =>
    id ? graph.statuses.find((s) => s.id === id)?.name ?? "—" : "(create)";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Workflow: <span className="font-medium text-foreground">{graph.name}</span>
        </p>
        <Button variant="outline" size="sm" className="gap-1" onClick={validate} disabled={busy === "validate"}>
          {busy === "validate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Validate
        </Button>
      </div>

      {result ? (
        <div
          className={
            "space-y-1 rounded-lg border px-4 py-3 text-sm " +
            (result.valid
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-destructive/40 bg-destructive/10 text-destructive")
          }
        >
          <p className="flex items-center gap-2 font-medium">
            {result.valid ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {result.valid ? "Workflow is valid." : "Workflow has problems:"}
          </p>
          {result.errors?.map((e, i) => <p key={`e${i}`} className="pl-6">• {e}</p>)}
          {result.warnings?.map((w, i) => (
            <p key={`w${i}`} className="pl-6 text-amber-700 dark:text-amber-300">⚠ {w}</p>
          ))}
        </div>
      ) : null}

      {/* Statuses */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Statuses</h3>
        <ul className="divide-y rounded-lg border">
          {graph.statuses
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span aria-hidden="true" className="h-3 w-3 rounded" style={{ backgroundColor: s.color }} />
                <span className="font-medium">{s.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {s.category_name}
                </span>
                {s.is_initial ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">initial</span>
                ) : null}
                {s.pauses_sla ? (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                    SLA paused
                  </span>
                ) : null}
                {canEdit ? (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Status settings"
                      title="Status settings"
                      onClick={() => setConfigStatus(s)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete status"
                      disabled={busy === s.id}
                      onClick={() => void removeStatus(s.id)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
        </ul>
        {canEdit ? (
          <form onSubmit={addStatus} className="flex flex-wrap items-end gap-2">
            <Input
              value={statusName}
              onChange={(e) => setStatusName(e.target.value)}
              placeholder="New status name"
              className="w-52"
            />
            <Select value={statusCat} onValueChange={setStatusCat}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground" title="Pause all SLA clocks while a ticket is in this status (e.g. Hold)">
              <input
                type="checkbox"
                checked={statusPausesSla}
                onChange={(e) => setStatusPausesSla(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Exclude from SLA
            </label>
            <Button type="submit" size="sm" className="gap-1" disabled={busy === "status" || !statusName.trim()}>
              {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add status
            </Button>
          </form>
        ) : null}
      </section>

      {/* Transitions */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Transitions</h3>
        <ul className="divide-y rounded-lg border">
          {graph.transitions
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {statusName_(t.from_status)} → {statusName_(t.to_status)}
                </span>
                {t.is_global ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">global</span>
                ) : null}
                {t.note_prompt ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                    note: {t.note_heading || "—"}{t.note_required ? " *" : ""}
                  </span>
                ) : null}
                {t.screen_fields?.length ? (
                  <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-600 dark:text-sky-400">
                    {t.screen_fields.length} field{t.screen_fields.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {t.field_conditions?.length ? (
                  <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-600 dark:text-rose-400">
                    {t.field_conditions.length} rule{t.field_conditions.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {t.portal_allowed ? (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                    portal
                  </span>
                ) : null}
                {t.post_functions?.some((pf) => pf.type === "request_approval") ? (
                  <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-xs text-violet-600 dark:text-violet-400">
                    starts approval
                  </span>
                ) : null}
                {t.conditions?.some((c) => c.condition_type === "approval_granted" && !c.negate) ? (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                    needs approval
                  </span>
                ) : null}
                {canEdit ? (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Configure transition"
                      title="Configure transition"
                      onClick={() => setConfigTransition(t)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete transition"
                      disabled={busy === t.id}
                      onClick={() => void removeTransition(t.id)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
        </ul>
        {canEdit ? (
          <form onSubmit={addTransition} className="flex flex-wrap items-end gap-2">
            <Input
              value={transName}
              onChange={(e) => setTransName(e.target.value)}
              placeholder="Transition name"
              className="w-44"
            />
            <Select value={fromStatus} onValueChange={setFromStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="From" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__create__">(create)</SelectItem>
                {graph.statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={toStatus} onValueChange={setToStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="To" /></SelectTrigger>
              <SelectContent>
                {graph.statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" className="gap-1" disabled={busy === "transition" || !transName.trim() || !toStatus}>
              {busy === "transition" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add transition
            </Button>
          </form>
        ) : null}
      </section>

      {configTransition ? (
        <TransitionNoteDialog
          key={configTransition.id}
          transition={configTransition}
          project={project}
          approvalWorkflows={approvalWorkflows}
          onClose={() => setConfigTransition(null)}
          onSaved={() => {
            setConfigTransition(null);
            void load();
          }}
        />
      ) : null}

      {configStatus ? (
        <StatusSettingsDialog
          key={configStatus.id}
          status={configStatus}
          onClose={() => setConfigStatus(null)}
          onSaved={() => {
            setConfigStatus(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

const NO_APPROVAL = "__none__";

// Field types the transition capture slide-over can render + persist today (see
// `ScreenFieldControl` in ticket-detail.tsx). cascade / multiselect / user_picker /
// group_picker / richtext / attachment are deferred and hidden from the picker.
const SCREEN_FIELD_TYPES = new Set([
  "text", "multiline", "number", "date", "dropdown", "radio", "checkbox",
]);

// Field-condition (block-with-message validator) operators. `equals`/`not_equals`
// additionally need a value to compare against.
const CONDITION_OPERATORS: { value: TransitionFieldConditionOperator; label: string }[] = [
  { value: "is_not_empty", label: "must not be empty" },
  { value: "is_empty", label: "must be empty" },
  { value: "equals", label: "must equal" },
  { value: "not_equals", label: "must not equal" },
];
const CONDITION_NEEDS_VALUE = new Set<TransitionFieldConditionOperator>(["equals", "not_equals"]);

/** Per-transition config: portal flag, note prompt (toggle/heading/visibility/requirement),
 *  approval wiring (start an approval workflow + require the approval gate), and the
 *  capture fields shown when the transition runs (e.g. Resolve → Root cause).
 *  Module-top-level + remounted per transition (via `key`), so its local form state
 *  initialises straight from props (React focus-stability). */
function TransitionNoteDialog({
  transition,
  project,
  approvalWorkflows,
  onClose,
  onSaved,
}: {
  transition: WorkflowTransition;
  project: Project;
  approvalWorkflows: ApprovalWorkflow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState(!!transition.note_prompt);
  const [heading, setHeading] = useState(transition.note_heading ?? "");
  const [visibility, setVisibility] = useState<TransitionNoteVisibility>(
    transition.note_visibility ?? "public",
  );
  const [requirement, setRequirement] = useState(transition.note_required ? "required" : "optional");
  const [portalAllowed, setPortalAllowed] = useState(!!transition.portal_allowed);
  // Start-approval = which ApprovalWorkflow the `request_approval` post-function points at.
  const [startApprovalId, setStartApprovalId] = useState<string>(() => {
    const pf = transition.post_functions?.find((p) => p.type === "request_approval");
    return (pf?.config?.workflow_id as string | undefined) ?? NO_APPROVAL;
  });
  // Require-approval = presence of the `approval_granted` gate condition.
  const [requireApproval, setRequireApproval] = useState(
    !!transition.conditions?.some((c) => c.condition_type === "approval_granted" && !c.negate),
  );
  // Capture fields: the transition's screen fields (ordered), edited locally then
  // sent as `screen_fields` on save (replaces the screen). The picker offers the
  // project's field catalog (custom + system) minus the already-added / unsupported.
  const [screenRows, setScreenRows] = useState<TransitionScreenFieldConfig[]>(() =>
    [...(transition.screen_fields ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  );
  const [catalog, setCatalog] = useState<FieldDefinition[]>([]);
  const [addKey, setAddKey] = useState("");
  // Field conditions: block-with-message validators (e.g. Assignee must not be empty).
  // Keyed by field_key (one rule per field) so the message <Input> has a stable React key.
  const [conditionRows, setConditionRows] = useState<TransitionFieldCondition[]>(
    () => [...(transition.field_conditions ?? [])],
  );
  const [addConditionKey, setAddConditionKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fieldsApi
      .list(project.id)
      .then((defs) => { if (alive) setCatalog(defs); })
      .catch(() => { if (alive) setCatalog([]); });
    return () => { alive = false; };
  }, [project.id]);

  const fieldName = (key: string) => catalog.find((f) => f.key === key)?.name ?? key;
  const addable = catalog.filter(
    (f) => SCREEN_FIELD_TYPES.has(f.field_type) && !screenRows.some((r) => r.field_key === f.key),
  );

  const addField = (key: string) => {
    if (!key || screenRows.some((r) => r.field_key === key)) return;
    setScreenRows((rows) => [
      ...rows,
      { field_key: key, is_mandatory: false, sort_order: rows.length },
    ]);
    setAddKey("");
  };
  const removeField = (key: string) =>
    setScreenRows((rows) => rows.filter((r) => r.field_key !== key));
  const setMandatory = (key: string, mandatory: boolean) =>
    setScreenRows((rows) => rows.map((r) => (r.field_key === key ? { ...r, is_mandatory: mandatory } : r)));
  const moveField = (idx: number, dir: -1 | 1) =>
    setScreenRows((rows) => {
      const next = [...rows];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return rows;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  // Field conditions — offer the WHOLE catalog (unlike capture fields): a validator only
  // READS a value, so assignee (user_picker), group, etc. must be selectable — the
  // "assignee must not be empty" case is the headline requirement. One rule per field.
  const conditionAddable = catalog.filter(
    (f) => !conditionRows.some((r) => r.field_key === f.key),
  );
  const defaultConditionMessage = (key: string) =>
    `${fieldName(key)} is required to run “${transition.name}”.`;
  const addCondition = (key: string) => {
    if (!key || conditionRows.some((r) => r.field_key === key)) return;
    setConditionRows((rows) => [
      ...rows,
      { field_key: key, operator: "is_not_empty", value: "", message: defaultConditionMessage(key) },
    ]);
    setAddConditionKey("");
  };
  const removeCondition = (key: string) =>
    setConditionRows((rows) => rows.filter((r) => r.field_key !== key));
  const updateCondition = (key: string, patch: Partial<TransitionFieldCondition>) =>
    setConditionRows((rows) => rows.map((r) => (r.field_key === key ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true);
    try {
      // Merge the `request_approval` post-function: preserve every other post-function,
      // drop any existing approval one, then re-add it only if a workflow is selected.
      const postFunctions = (transition.post_functions ?? []).filter(
        (pf) => pf.type !== "request_approval",
      );
      if (startApprovalId !== NO_APPROVAL) {
        postFunctions.push({ type: "request_approval", config: { workflow_id: startApprovalId } });
      }
      await workflowsApi.updateTransition(transition.id, {
        note_prompt: prompt,
        note_required: prompt && requirement === "required",
        note_heading: prompt ? heading.trim() : "",
        note_visibility: visibility,
        portal_allowed: portalAllowed,
        post_functions: postFunctions,
        requires_approval: requireApproval,
        screen_fields: screenRows.map((r, i) => ({ ...r, sort_order: i })),
        // Drop the stray value for presence-checks; back-fill a message so the backend
        // `validate_field_conditions` never rejects a blank one.
        field_conditions: conditionRows.map((r) => ({
          field_key: r.field_key,
          operator: r.operator,
          ...(CONDITION_NEEDS_VALUE.has(r.operator) ? { value: r.value ?? "" } : {}),
          message: r.message.trim() || defaultConditionMessage(r.field_key),
        })),
      });
      onSaved();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not save the transition settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transition settings — {transition.name}</DialogTitle>
          <DialogDescription>
            Ask the agent for a note when this transition runs (e.g. a “Reason to hold”). The note
            is posted as a comment on the ticket. You can also let end-users run this transition
            from the Service Portal (e.g. Reopen).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={portalAllowed}
              onChange={(e) => setPortalAllowed(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Allowed from portal <span className="font-normal text-muted-foreground">— lets requestors run this (e.g. Reopen)</span>
          </label>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Start approval when this transition runs</label>
              {approvalWorkflows.length ? (
                <Select value={startApprovalId} onValueChange={setStartApprovalId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="No approval" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_APPROVAL}>— None —</SelectItem>
                    {approvalWorkflows.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No approval rules yet — create one in the Approval tab.
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Require approval to run this transition
            </label>
            <p className="text-xs text-muted-foreground">
              These pair up: set <span className="font-medium">Start approval</span> on the transition
              <span className="font-medium"> into</span> a state, and{" "}
              <span className="font-medium">Require approval</span> on the transition{" "}
              <span className="font-medium">out of</span> it. A required transition stays blocked
              until the approval is granted.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={prompt}
              onChange={(e) => setPrompt(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Prompt for a note on this transition
          </label>

          {prompt ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Note heading</label>
                <Input
                  value={heading}
                  onChange={(e) => setHeading(e.target.value)}
                  placeholder="e.g. Reason to hold"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Note type</label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as TransitionNoteVisibility)}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public Comment</SelectItem>
                      <SelectItem value="private">Internal Note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Requirement</label>
                  <Select value={requirement} onValueChange={setRequirement}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="optional">Optional</SelectItem>
                      <SelectItem value="required">Mandatory</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}

          {/* Capture fields — the typed fields the agent fills in when this transition
              runs (e.g. Resolve → Root cause / Resolution type). Reuses the project's
              field catalog; mark each Mandatory or Optional. */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Capture fields on this transition</p>
              <p className="text-xs text-muted-foreground">
                Fields the agent fills in when running this transition. Define fields first in the{" "}
                <span className="font-medium">Fields</span> tab, then add them here and mark each
                mandatory or optional. Captured values are saved on the ticket.
              </p>
            </div>

            {screenRows.length ? (
              <ul className="space-y-1.5">
                {screenRows.map((row, idx) => (
                  <li
                    key={row.field_key}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={idx === 0}
                        onClick={() => moveField(idx, -1)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={idx === screenRows.length - 1}
                        onClick={() => moveField(idx, 1)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm">{fieldName(row.field_key)}</span>
                    <Select
                      value={row.is_mandatory ? "required" : "optional"}
                      onValueChange={(v) => setMandatory(row.field_key, v === "required")}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="optional">Optional</SelectItem>
                        <SelectItem value="required">Mandatory</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      aria-label={`Remove ${fieldName(row.field_key)}`}
                      onClick={() => removeField(row.field_key)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No capture fields yet.</p>
            )}

            {addable.length ? (
              <Select value={addKey} onValueChange={addField}>
                <SelectTrigger className="w-full">
                  <span className="flex items-center gap-1.5 text-sm">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add field
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {addable.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.name}
                      {f.is_system ? " (system)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                {catalog.length
                  ? "All eligible fields are already added."
                  : "No fields available — add fields in the Fields tab first."}
              </p>
            )}
          </div>

          {/* Field conditions — JIRA-style validators. The transition stays visible;
              running it is blocked with the rule's message unless every rule passes
              (e.g. Assignee must not be empty before moving to Assigned). */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Field conditions to allow this transition</p>
              <p className="text-xs text-muted-foreground">
                Block this transition unless the ticket’s fields meet these rules. The
                transition stays visible; running it shows your message if a rule fails
                (e.g. don’t allow moving to Assigned while Assignee is empty).
              </p>
            </div>

            {conditionRows.length ? (
              <ul className="space-y-1.5">
                {conditionRows.map((row) => {
                  const needsValue = CONDITION_NEEDS_VALUE.has(row.operator);
                  return (
                    <li
                      key={row.field_key}
                      className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                    >
                      <span className="min-w-0 basis-full truncate text-sm sm:basis-auto sm:flex-1">
                        {fieldName(row.field_key)}
                      </span>
                      <Select
                        value={row.operator}
                        onValueChange={(v) =>
                          updateCondition(row.field_key, { operator: v as TransitionFieldConditionOperator })
                        }
                      >
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_OPERATORS.map((op) => (
                            <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {needsValue ? (
                        <Input
                          value={row.value ?? ""}
                          onChange={(e) => updateCondition(row.field_key, { value: e.target.value })}
                          placeholder="value"
                          className="w-32"
                        />
                      ) : null}
                      <Input
                        value={row.message}
                        onChange={(e) => updateCondition(row.field_key, { message: e.target.value })}
                        placeholder="Error message shown when blocked"
                        className="min-w-[12rem] flex-1"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${fieldName(row.field_key)} condition`}
                        onClick={() => removeCondition(row.field_key)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No field conditions yet.</p>
            )}

            {conditionAddable.length ? (
              <Select value={addConditionKey} onValueChange={addCondition}>
                <SelectTrigger className="w-full">
                  <span className="flex items-center gap-1.5 text-sm">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add condition
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {conditionAddable.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.name}
                      {f.is_system ? " (system)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                {catalog.length
                  ? "All fields already have a condition."
                  : "No fields available — add fields in the Fields tab first."}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1"
            onClick={save}
            disabled={
              saving ||
              (prompt && !heading.trim()) ||
              conditionRows.some((r) => CONDITION_NEEDS_VALUE.has(r.operator) && !(r.value ?? "").trim())
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Per-status settings: the "Exclude from SLA calculation" toggle. When on, a ticket
 *  entering this status pauses all of its running SLA clocks (they resume on leaving).
 *  Module-top-level + remounted per status (via `key`), so its local form state
 *  initialises straight from props (React focus-stability). */
function StatusSettingsDialog({
  status,
  onClose,
  onSaved,
}: {
  status: WorkflowStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pausesSla, setPausesSla] = useState(!!status.pauses_sla);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await workflowsApi.updateStatus(status.id, { pauses_sla: pausesSla });
      onSaved();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not save the status settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Status settings — {status.name}</DialogTitle>
          <DialogDescription>
            Control how this status affects SLA. Use “Exclude from SLA” for hold-type states
            (e.g. waiting on the requester or a vendor) so the SLA clocks stop counting while a
            ticket sits here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={pausesSla}
              onChange={(e) => setPausesSla(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Exclude from SLA calculation
            <span className="font-normal text-muted-foreground">— pauses all SLA clocks while on this status</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" className="gap-1" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
