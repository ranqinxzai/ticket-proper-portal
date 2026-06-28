"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { approvalWorkflowsApi, groupsApi, rolesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type {
  ApprovalStage,
  ApprovalWorkflow,
  ApproverType,
  Group,
  Project,
  SystemRole,
  UserRef,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { UserSearchCombobox } from "./user-search-combobox";

const APPROVER_TYPES: { value: ApproverType; label: string }[] = [
  { value: "specific_user", label: "Specific user" },
  { value: "role", label: "Anyone with role" },
  { value: "group", label: "Anyone in group" },
  { value: "requestor_manager", label: "Requestor's manager" },
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

  async function removeWorkflow(id: string) {
    setBusy(id);
    try {
      await approvalWorkflowsApi.delete(id);
      setWorkflows((w) => w.filter((x) => x.id !== id));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Multi-level sign-off policies for this project. Trigger one from a workflow transition
        (post-function) or start it manually on a ticket.
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
              onRemove={() => removeWorkflow(wf.id)}
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
            className="max-w-xs"
          />
          <Button type="submit" size="sm" className="gap-1" disabled={busy === "add" || !newName.trim()}>
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add workflow
          </Button>
        </form>
      ) : null}
    </div>
  );
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

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    if (!stageName.trim()) return;
    setBusy(`stage-${workflow.id}`);
    try {
      await approvalWorkflowsApi.createStage({
        workflow: workflow.id,
        name: stageName.trim(),
        level: (workflow.stages?.length ?? 0) + 1,
        approver_type: approverType,
        approver_user: approverType === "specific_user" ? approverUser?.id ?? null : null,
        approver_role: approverType === "role" ? approverRole || null : null,
        approver_group: approverType === "group" ? approverGroup || null : null,
        rule: "any",
        min_approvals: 1,
      });
      setStageName("");
      setApproverUser(null);
      setApproverRole("");
      setApproverGroup("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the stage.");
    } finally {
      setBusy(null);
    }
  }

  async function removeStage(id: string) {
    setBusy(id);
    try {
      await approvalWorkflowsApi.deleteStage(id);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the stage.");
    } finally {
      setBusy(null);
    }
  }

  function approverLabel(s: ApprovalStage): string {
    switch (s.approver_type) {
      case "specific_user":
        return "Specific user";
      case "role":
        return `Role: ${roles.find((r) => r.id === s.approver_role)?.name ?? "—"}`;
      case "group":
        return `Group: ${groups.find((g) => g.id === s.approver_group)?.name ?? "—"}`;
      case "requestor_manager":
        return "Requestor's manager";
      default:
        return s.approver_type;
    }
  }

  const stages = [...(workflow.stages ?? [])].sort((a, b) => a.level - b.level);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">{workflow.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{workflow.mode}</span>
        {!workflow.is_active ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">inactive</span>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            aria-label="Delete approval workflow"
            disabled={busy === workflow.id}
            onClick={onRemove}
            className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        {stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stages yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {stages.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {s.level}
                </span>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{approverLabel(s)}</span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label="Delete stage"
                    disabled={busy === s.id}
                    onClick={() => void removeStage(s.id)}
                    className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
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
              className="w-40"
            />
            <Select value={approverType} onValueChange={(v) => setApproverType(v as ApproverType)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {APPROVER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {approverType === "specific_user" ? (
              <div className="w-52">
                <UserSearchCombobox
                  label={approverUser ? approverUser.full_name || approverUser.username : null}
                  onSelect={setApproverUser}
                  onClear={() => setApproverUser(null)}
                />
              </div>
            ) : null}
            {approverType === "role" ? (
              <Select value={approverRole} onValueChange={setApproverRole}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {approverType === "group" ? (
              <Select value={approverGroup} onValueChange={setApproverGroup}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Group" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <Button
              type="submit"
              size="sm"
              className="gap-1"
              disabled={busy === `stage-${workflow.id}` || !stageName.trim()}
            >
              {busy === `stage-${workflow.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add stage
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
