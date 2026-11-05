"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, Trash2, X } from "lucide-react";

import { approvalWorkflowsApi, groupsApi, rolesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type {
  ApprovalMode,
  ApprovalStage,
  ApprovalWorkflow,
  ApproverType,
  Group,
  OnFlyPool,
  Project,
  SystemRole,
  UserRef,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { APPROVAL_HELP, APPROVER_TYPE_HELP, NO_EDIT_PERMISSION } from "@/lib/itsm/help/settings";

import { UserSearchCombobox } from "./user-search-combobox";

const APPROVER_TYPES: { value: ApproverType; label: string }[] = [
  { value: "specific_user", label: "Specific user" },
  { value: "role", label: "Anyone with role" },
  { value: "group", label: "Anyone in group" },
  { value: "requestor_manager", label: "Requestor's manager" },
  { value: "on_the_fly", label: "On fly (agent picks)" },
];

const ON_FLY_POOLS: { value: OnFlyPool; label: string }[] = [
  { value: "any_user", label: "Any user" },
  { value: "group", label: "Members of a group" },
  { value: "listed_users", label: "Listed users" },
];

const MODES: { value: ApprovalMode; label: string }[] = [
  { value: "sequential", label: "Sequential" },
  { value: "parallel", label: "Parallel" },
];

export function ApprovalEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { helpdesk } = useWorkspace();
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    approvalWorkflowsApi
      .list({ project: project.id })
      .then(setWorkflows)
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => {
    load();
    rolesApi.list().then(setRoles).catch(() => setRoles([]));
    if (helpdesk) groupsApi.list({ helpdesk: helpdesk.id }).then(setGroups).catch(() => setGroups([]));
  }, [load, helpdesk]);

  async function addWorkflow(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy("add");
    try {
      await approvalWorkflowsApi.create({
        name: newName.trim(),
        project: project.id,
        helpdesk: helpdesk?.id ?? null,
        mode: "sequential",
        is_active: true,
      });
      setNewName("");
      load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not create the approval workflow.");
    } finally {
      setBusy(null);
    }
  }

  async function removeWorkflow(wf: ApprovalWorkflow) {
    if (
      !window.confirm(
        `Delete “${wf.name}”? Transitions that start it will stop asking for approval; approvals already in progress continue. This can't be undone.`,
      )
    )
      return;
    setBusy(wf.id);
    try {
      await approvalWorkflowsApi.delete(wf.id);
      setWorkflows((w) => w.filter((x) => x.id !== wf.id));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        Multi-level sign-off policies for this project. Trigger one from a workflow transition
        (Workflow tab → transition settings → Start approval), or let agents send a ticket for approval.
        <InfoTip label="How approvals start">{APPROVAL_HELP.sendSetup}</InfoTip>
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading approvals…
        </p>
      ) : workflows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No approval workflows for this project yet.
        </div>
      ) : (
        <div className="space-y-4">
          {workflows.map((wf) => (
            <ApprovalWorkflowCard
              key={wf.id}
              workflow={wf}
              roles={roles}
              groups={groups}
              canEdit={canEdit}
              busy={busy}
              setBusy={setBusy}
              onChanged={load}
              onRemove={() => removeWorkflow(wf)}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <form onSubmit={addWorkflow} className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New approval workflow name"
            aria-label="New approval workflow name"
            className="max-w-xs"
          />
          <Hint label={busy !== "add" && !newName.trim() ? "Enter a name first" : ""}>
            <Button type="submit" size="sm" className="gap-1" disabled={busy === "add" || !newName.trim()}>
              {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Add workflow
            </Button>
          </Hint>
        </form>
      ) : null}
    </div>
  );
}

function approverLabel(s: ApprovalStage, roles: SystemRole[], groups: Group[]): string {
  switch (s.approver_type) {
    case "specific_user":
      return s.approver_user_name ?? "No approver set";
    case "role":
      return `Role: ${s.approver_role_name ?? roles.find((r) => r.id === s.approver_role)?.name ?? "—"}`;
    case "group":
      return `Group: ${s.approver_group_name ?? groups.find((g) => g.id === s.approver_group)?.name ?? "—"}`;
    case "requestor_manager":
      return s.approver_user_name
        ? `Requestor's manager (fallback: ${s.approver_user_name})`
        : "Requestor's manager";
    case "on_the_fly": {
      if (s.on_fly_pool === "group")
        return `On fly · from ${s.approver_group_name ?? groups.find((g) => g.id === s.approver_group)?.name ?? "a group"}`;
      if (s.on_fly_pool === "listed_users") {
        const n = s.candidate_users_detail?.length ?? s.candidate_users?.length ?? 0;
        return `On fly · from ${n} ${n === 1 ? "person" : "people"}`;
      }
      return "On fly · any user";
    }
    default:
      return s.approver_type;
  }
}

function ApprovalWorkflowCard({
  workflow,
  roles,
  groups,
  canEdit,
  busy,
  setBusy,
  onChanged,
  onRemove,
}: {
  workflow: ApprovalWorkflow;
  roles: SystemRole[];
  groups: Group[];
  canEdit: boolean;
  busy: string | null;
  setBusy: (v: string | null) => void;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [stageName, setStageName] = useState("");
  const [approverType, setApproverType] = useState<ApproverType>("specific_user");
  const [approverUser, setApproverUser] = useState<UserRef | null>(null);
  const [approverRole, setApproverRole] = useState("");
  const [approverGroup, setApproverGroup] = useState("");
  const [onFlyPool, setOnFlyPool] = useState<OnFlyPool>("any_user");
  const [listedUsers, setListedUsers] = useState<UserRef[]>([]);

  const stageBusy = busy === `stage-${workflow.id}`;
  const settingsBusy = busy === `settings-${workflow.id}`;
  // B1: a stage must name who approves it (Requestor's manager resolves per ticket;
  // its fallback approver is optional).
  const addBlocker = !stageName.trim()
    ? "Enter a stage name first"
    : approverType === "specific_user" && !approverUser
      ? "Pick the approver first"
      : approverType === "role" && !approverRole
        ? "Pick a role first"
        : (approverType === "group" || (approverType === "on_the_fly" && onFlyPool === "group")) &&
            !approverGroup
          ? "Pick a group first"
          : approverType === "on_the_fly" && onFlyPool === "listed_users" && listedUsers.length === 0
            ? "Add at least one person to pick from"
            : null;

  async function patchWorkflow(body: Partial<ApprovalWorkflow>) {
    setBusy(`settings-${workflow.id}`);
    try {
      await approvalWorkflowsApi.update(workflow.id, body);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not save the change.");
    } finally {
      setBusy(null);
    }
  }

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    if (addBlocker) return;
    setBusy(`stage-${workflow.id}`);
    try {
      // No `level`: the server appends after the highest live level.
      await approvalWorkflowsApi.createStage({
        workflow: workflow.id,
        name: stageName.trim(),
        approver_type: approverType,
        approver_user:
          approverType === "specific_user" || approverType === "requestor_manager"
            ? approverUser?.id ?? null
            : null,
        approver_role: approverType === "role" ? approverRole || null : null,
        approver_group:
          approverType === "group" || (approverType === "on_the_fly" && onFlyPool === "group")
            ? approverGroup || null
            : null,
        on_fly_pool: approverType === "on_the_fly" ? onFlyPool : "",
        candidate_users:
          approverType === "on_the_fly" && onFlyPool === "listed_users" ? listedUsers.map((u) => u.id) : [],
        rule: "any",
        min_approvals: 1,
      });
      setStageName("");
      setApproverUser(null);
      setApproverRole("");
      setApproverGroup("");
      setListedUsers([]);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the stage.");
    } finally {
      setBusy(null);
    }
  }

  async function removeStage(s: ApprovalStage) {
    if (!window.confirm(`Delete stage “${s.name}”? Approvals already in progress still wait on it. This can't be undone.`))
      return;
    setBusy(s.id);
    try {
      await approvalWorkflowsApi.deleteStage(s.id);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the stage.");
    } finally {
      setBusy(null);
    }
  }

  const stages = [...(workflow.stages ?? [])].sort((a, b) => a.level - b.level);
  const parallel = workflow.mode === "parallel";
  const sendOnly = stages.some((s) => s.approver_type === "on_the_fly");

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">{workflow.name}</span>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Select
              value={workflow.mode}
              onValueChange={(v) => void patchWorkflow({ mode: v as ApprovalMode })}
              disabled={settingsBusy}
            >
              <SelectTrigger className="h-7 w-32 text-xs" aria-label="Approval mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InfoTip label="About the approval mode">
              {`${APPROVAL_HELP.mode}\n${parallel ? APPROVAL_HELP.parallel : APPROVAL_HELP.sequential}`}
            </InfoTip>
          </div>
        ) : (
          <Hint label={parallel ? APPROVAL_HELP.parallel : APPROVAL_HELP.sequential}>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize text-muted-foreground">{workflow.mode}</span>
          </Hint>
        )}
        {sendOnly ? (
          <Hint label={APPROVAL_HELP.onFlyOnlySend}>
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-xs text-violet-700 dark:text-violet-300">
              Send for approval only
            </span>
          </Hint>
        ) : null}
        {!workflow.is_active ? (
          <Hint label={APPROVAL_HELP.inactive}>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">inactive</span>
          </Hint>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hint label={!canEdit ? NO_EDIT_PERMISSION : settingsBusy ? "Saving…" : ""}>
              <Switch
                checked={!!workflow.pause_sla}
                disabled={!canEdit || settingsBusy}
                onCheckedChange={(v) => void patchWorkflow({ pause_sla: v })}
                aria-label={`${workflow.name}: pause SLA while waiting`}
              />
            </Hint>
            Pause SLA while waiting
          </label>
          <InfoTip label="About pausing the SLA while waiting">{APPROVAL_HELP.pauseSla}</InfoTip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Hint label={!canEdit ? NO_EDIT_PERMISSION : settingsBusy ? "Saving…" : APPROVAL_HELP.activeToggle}>
            <Switch
              checked={workflow.is_active}
              disabled={!canEdit || settingsBusy}
              onCheckedChange={(v) => void patchWorkflow({ is_active: v })}
              aria-label={`${workflow.name} active`}
            />
          </Hint>
          {canEdit ? (
            <IconButton
              label={`Delete ${workflow.name}`}
              disabledReason="Deleting…"
              disabled={busy === workflow.id}
              onClick={onRemove}
              className="h-7 w-7 text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stages yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {stages.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <Hint label={parallel ? APPROVAL_HELP.parallel : APPROVAL_HELP.level(s.level)}>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary-ink">
                    {s.level}
                  </span>
                </Hint>
                <span className="font-medium">{s.name}</span>
                <Hint
                  label={
                    s.approver_type === "on_the_fly" && s.on_fly_pool === "listed_users"
                      ? `${APPROVER_TYPE_HELP.on_the_fly}\nCan pick: ${(s.candidate_users_detail ?? [])
                          .map((u) => (u.is_active ? u.name : `${u.name} (deactivated)`))
                          .join(", ")}`
                      : APPROVER_TYPE_HELP[s.approver_type] ?? ""
                  }
                >
                  <span className="text-xs text-muted-foreground">{approverLabel(s, roles, groups)}</span>
                </Hint>
                {s.approver_problem ? (
                  <Hint
                    label={
                      s.approver_type === "on_the_fly"
                        ? APPROVAL_HELP.onFlyProblem(s.approver_problem)
                        : APPROVAL_HELP.stageProblem(s.approver_problem)
                    }
                  >
                    <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> No approver
                    </span>
                  </Hint>
                ) : null}
                {canEdit ? (
                  <IconButton
                    label={`Delete stage ${s.name}`}
                    disabledReason="Deleting…"
                    disabled={busy === s.id}
                    onClick={() => void removeStage(s)}
                    className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {canEdit ? (
          <form onSubmit={addStage} className="flex flex-wrap items-end gap-2 border-t pt-3">
            <Input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="Stage name (e.g. Level 1)"
              aria-label="Stage name"
              className="w-40"
            />
            <div className="flex items-center gap-1">
              <Select
                value={approverType}
                onValueChange={(v) => {
                  setApproverType(v as ApproverType);
                  setApproverUser(null);
                }}
              >
                <SelectTrigger className="w-44" aria-label="Approver type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {APPROVER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <InfoTip label="About this approver type">{APPROVER_TYPE_HELP[approverType]}</InfoTip>
            </div>

            {approverType === "specific_user" ? (
              <div className="w-52">
                <UserSearchCombobox
                  label={approverUser ? approverUser.full_name || approverUser.username : null}
                  onSelect={setApproverUser}
                  onClear={() => setApproverUser(null)}
                />
              </div>
            ) : null}
            {approverType === "requestor_manager" ? (
              <div className="flex items-center gap-1">
                <div className="w-52">
                  <UserSearchCombobox
                    label={approverUser ? approverUser.full_name || approverUser.username : null}
                    placeholder="Fallback approver (optional)"
                    onSelect={setApproverUser}
                    onClear={() => setApproverUser(null)}
                  />
                </div>
                <InfoTip label="About the fallback approver">{APPROVAL_HELP.fallback}</InfoTip>
              </div>
            ) : null}
            {approverType === "role" ? (
              <Select value={approverRole} onValueChange={setApproverRole}>
                <SelectTrigger className="w-44" aria-label="Approver role"><SelectValue placeholder="Role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {approverType === "on_the_fly" ? (
              <div className="flex items-center gap-1">
                <Select value={onFlyPool} onValueChange={(v) => setOnFlyPool(v as OnFlyPool)}>
                  <SelectTrigger className="w-44" aria-label="Pick approvers from"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ON_FLY_POOLS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <InfoTip label="Who the agent picks from">{`${APPROVAL_HELP.onFlyPool}\n${APPROVAL_HELP.onFlyRule}`}</InfoTip>
              </div>
            ) : null}
            {approverType === "on_the_fly" && onFlyPool === "listed_users" ? (
              <div className="w-56 space-y-1">
                <UserSearchCombobox
                  value={null}
                  placeholder="Add a person…"
                  onSelect={(u) =>
                    setListedUsers((cur) => (cur.some((x) => String(x.id) === String(u.id)) ? cur : [...cur, u]))
                  }
                />
                {listedUsers.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {listedUsers.map((u) => {
                      const name = u.full_name || u.username;
                      return (
                        <span key={u.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {name}
                          <IconButton
                            label={`Remove ${name}`}
                            className="h-4 w-4 p-0 hover:bg-transparent hover:text-destructive"
                            onClick={() => setListedUsers((cur) => cur.filter((x) => x.id !== u.id))}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </IconButton>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {approverType === "group" || (approverType === "on_the_fly" && onFlyPool === "group") ? (
              <Select value={approverGroup} onValueChange={setApproverGroup}>
                <SelectTrigger className="w-44" aria-label="Approver group"><SelectValue placeholder="Group" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <Hint label={!stageBusy && addBlocker ? addBlocker : ""}>
              <Button type="submit" size="sm" className="gap-1" disabled={stageBusy || !!addBlocker}>
                {stageBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )}
                Add stage
              </Button>
            </Hint>
          </form>
        ) : null}
      </div>
    </div>
  );
}
