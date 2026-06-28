"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { calendarsApi, groupsApi, projectsApi, workflowsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { BusinessCalendar, Group, Project, Workflow } from "@/lib/itsm/types";
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

import { ColorPicker } from "./color-picker";
import { FieldRow, fieldError } from "./field-row";
import { IconPicker } from "./icon-picker";

const NONE = "__none__";

export function ProjectOverviewTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { helpdesk, refresh } = useWorkspace();
  const baseId = useId();

  const [name, setName] = useState(project.name);
  const [key, setKey] = useState(project.key);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState(project.status);
  const [icon, setIcon] = useState(project.icon ?? "");
  const [color, setColor] = useState(project.color ?? "#6366f1");
  const [defaultGroup, setDefaultGroup] = useState(project.default_group ?? NONE);
  const [defaultWorkflow, setDefaultWorkflow] = useState(project.default_workflow ?? NONE);
  const [calendar, setCalendar] = useState(project.calendar ?? NONE);

  const [groups, setGroups] = useState<Group[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (helpdesk) groupsApi.list({ helpdesk: helpdesk.id }).then(setGroups).catch(() => setGroups([]));
    workflowsApi.list({ is_active: true }).then(setWorkflows).catch(() => setWorkflows([]));
    calendarsApi.list().then(setCalendars).catch(() => setCalendars([]));
  }, [helpdesk]);

  const keyChanged = key.trim().toUpperCase() !== project.key;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    setBusy(true);
    setErrors({});
    try {
      await projectsApi.update(project.id, {
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim(),
        status,
        icon,
        color,
        default_group: defaultGroup === NONE ? null : defaultGroup,
        default_workflow: defaultWorkflow === NONE ? null : defaultWorkflow,
        calendar: calendar === NONE ? null : calendar,
      });
      toast.success("Project saved.");
      await refresh();
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not save the project.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
        <Input id={`${baseId}-name`} value={name} disabled={!canEdit || busy} onChange={(e) => setName(e.target.value)} />
      </FieldRow>

      <FieldRow
        label="Key (prefix)"
        htmlFor={`${baseId}-key`}
        error={fieldError(errors, "key")}
        required
        hint="2–10 uppercase letters/digits; the ticket-number prefix for this project."
      >
        <Input
          id={`${baseId}-key`}
          value={key}
          disabled={!canEdit || busy}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          className="w-44 font-mono"
          maxLength={10}
        />
      </FieldRow>

      {keyChanged ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Existing tickets keep their numbers (e.g. <span className="font-mono">{project.key}-1</span>);
            only new tickets use the new prefix.
          </span>
        </div>
      ) : null}

      <FieldRow label="Description" htmlFor={`${baseId}-desc`}>
        <textarea
          id={`${baseId}-desc`}
          value={description}
          disabled={!canEdit || busy}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </FieldRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Status">
          <Select value={status} onValueChange={setStatus} disabled={!canEdit || busy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Default group">
          <Select value={defaultGroup} onValueChange={setDefaultGroup} disabled={!canEdit || busy}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Default workflow">
          <Select value={defaultWorkflow} onValueChange={setDefaultWorkflow} disabled={!canEdit || busy}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {workflows.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Business calendar" hint="SLA clocks for this project use this calendar.">
          <Select value={calendar} onValueChange={setCalendar} disabled={!canEdit || busy}>
            <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Use default</SelectItem>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.is_default ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </div>

      <FieldRow label="Icon">
        <IconPicker value={icon} onChange={setIcon} disabled={!canEdit || busy} />
      </FieldRow>

      <FieldRow label="Colour">
        <ColorPicker value={color} onChange={setColor} disabled={!canEdit || busy} />
      </FieldRow>

      {canEdit ? (
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save changes
        </Button>
      ) : null}
    </form>
  );
}
