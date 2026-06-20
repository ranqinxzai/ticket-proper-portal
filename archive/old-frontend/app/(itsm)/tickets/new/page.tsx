"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, FileText, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { RichTextEditor } from "@/components/itsm/RichTextEditor";
import { PriorityIcon, PRIORITIES, priorityLabel } from "@/components/itsm/ticket-bits";
import {
  projectsApi, groupsApi, usersApi, fieldsApi, templatesApi, ticketsApi,
} from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useSelectedHelpdesk } from "@/lib/itsm/helpdesk";
import type {
  AccountUser, FieldLayout, Group, LayoutField, Priority, Project, TicketTemplate, TicketType,
} from "@/lib/itsm/types";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3;
const NONE = "__none__";

export default function NewTicketPage() {
  const router = useRouter();
  const { selected: helpdesk } = useSelectedHelpdesk();
  const [step, setStep] = useState<Step>(1);

  // Lookups
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<AccountUser[]>([]);

  // Step 1 — type
  const [projectId, setProjectId] = useState<string>("");
  const [ticketType, setTicketType] = useState<string>("");

  // Step 2 — template
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");

  // Step 3 — details
  const [summary, setSummary] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [descHtml, setDescHtml] = useState("");
  const [descResetKey, setDescResetKey] = useState(0);
  const [assignee, setAssignee] = useState<string>(NONE);
  const [group, setGroup] = useState<string>(NONE);
  const [layout, setLayout] = useState<FieldLayout | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Projects are scoped to the selected helpdesk; re-fetch on switch.
  useEffect(() => {
    projectsApi.list(helpdesk?.key).then(setProjects).catch(() => setProjects([]));
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
    usersApi.list().then(setUsers).catch(() => setUsers([]));
  }, [helpdesk?.key]);

  // Open the wizard pre-scoped: default to the helpdesk's Incident project (the
  // user then only switches Incident↔Request within the helpdesk). Don't clobber
  // an explicit choice.
  useEffect(() => {
    if (projectId || projects.length === 0) return;
    const incident = projects.find((p) => p.project_type === "incident");
    setProjectId((incident ?? projects[0]).id);
  }, [projects, projectId]);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);
  const ticketTypes: TicketType[] = project?.ticket_types ?? [];

  // Reset ticket type when project changes; default to the first type.
  useEffect(() => {
    setTicketType(ticketTypes[0]?.id ?? "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load templates for the chosen project.
  useEffect(() => {
    if (!projectId) return;
    templatesApi.list(projectId).then(setTemplates).catch(() => setTemplates([]));
  }, [projectId]);

  // Load the field layout when we reach step 3.
  useEffect(() => {
    if (step !== 3 || !projectId || !ticketType) return;
    setLayoutLoading(true);
    fieldsApi
      .resolveLayout(projectId, ticketType)
      .then(setLayout)
      .catch(() => setLayout({ items: [] }))
      .finally(() => setLayoutLoading(false));
  }, [step, projectId, ticketType]);

  async function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id || id === NONE) return;
    try {
      const prefill = await ticketsApi.applyTemplate(id);
      if (typeof prefill.summary === "string") setSummary(prefill.summary);
      if (typeof prefill.priority === "string") setPriority(prefill.priority as Priority);
      if (typeof prefill.description_html === "string") {
        setDescHtml(prefill.description_html);
        setDescResetKey((k) => k + 1);
      }
      if (prefill.custom_fields && typeof prefill.custom_fields === "object") {
        setCustomValues((prev) => ({ ...prev, ...(prefill.custom_fields as Record<string, unknown>) }));
      }
      toast.success("Template applied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply template");
    }
  }

  function setCustom(key: string, value: unknown) {
    setCustomValues((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!summary.trim()) {
      toast.error("Summary is required");
      return;
    }
    setSubmitting(true);
    setFieldErrors({});
    try {
      const created = await ticketsApi.create({
        project: projectId,
        ticket_type: ticketType,
        summary: summary.trim(),
        description_html: descHtml || undefined,
        priority,
        assignee: assignee === NONE ? null : assignee,
        assigned_group: group === NONE ? null : group,
        source: "agent",
        custom_fields: Object.keys(customValues).length ? customValues : undefined,
      });
      toast.success(`Created ${created.ticket_number}`);
      router.push(`/tickets/${created.ticket_number}`);
    } catch (e) {
      if (e instanceof ItsmApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  }

  const visibleFields = (layout?.items ?? []).filter((f) => !f.is_hidden && !DEFAULT_FIELD_KEYS.has(f.field_key));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/queues")} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">Create ticket</h1>
      </div>

      <Stepper step={step} />

      <div className="rounded-lg border bg-white p-5">
        {/* STEP 1 — type */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {project && (
              <div className="grid gap-2">
                <Label>Ticket type</Label>
                {ticketTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This project has no ticket types.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ticketTypes.map((tt) => (
                      <button
                        key={tt.id}
                        type="button"
                        onClick={() => setTicketType(tt.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                          ticketType === tt.id ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "hover:bg-muted",
                        )}
                      >
                        <TicketIcon className="h-4 w-4 text-indigo-500" />
                        <span className="font-medium">{tt.name}</span>
                        {ticketType === tt.id && <Check className="ml-auto h-4 w-4 text-indigo-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button disabled={!projectId || !ticketType} onClick={() => setStep(2)} className="gap-1.5">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2 — template */}
        {step === 2 && (
          <div className="space-y-4">
            <Label>Start from a template (optional)</Label>
            <div className="space-y-2">
              <TemplateOption
                active={!templateId || templateId === NONE}
                title="Blank ticket"
                description="Start from scratch."
                onClick={() => applyTemplate(NONE)}
              />
              {templates.map((t) => (
                <TemplateOption
                  key={t.id}
                  active={templateId === t.id}
                  title={t.name}
                  description={t.description || "Prefilled template"}
                  onClick={() => applyTemplate(t.id)}
                />
              ))}
              {templates.length === 0 && (
                <p className="text-xs text-muted-foreground">No templates for this project.</p>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} className="gap-1.5">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3 — details */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="summary">Summary <span className="text-destructive">*</span></Label>
              <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Short, descriptive title" />
              <FieldError errors={fieldErrors.summary} />
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                  <SelectTrigger>
                    <span className="flex items-center gap-1.5"><PriorityIcon priority={priority} /> {priorityLabel(priority)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        <span className="flex items-center gap-1.5"><PriorityIcon priority={p} /> {priorityLabel(p)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Group</Label>
                <Select value={group} onValueChange={setGroup}>
                  <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No group</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.full_name || u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Description</Label>
              <RichTextEditor
                value={descHtml}
                resetKey={descResetKey}
                placeholder="Describe the issue…"
                onChange={(h) => setDescHtml(h)}
              />
            </div>

            {/* Dynamic custom fields from the layout */}
            {layoutLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading fields…
              </div>
            ) : (
              visibleFields.map((f) => (
                <DynamicField
                  key={f.field_key}
                  field={f}
                  value={customValues[f.field_key]}
                  error={fieldErrors[f.field_key]}
                  users={users}
                  groups={groups}
                  onChange={(v) => setCustom(f.field_key, v)}
                />
              ))
            )}

            <div className="flex justify-between pt-1">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={submit} disabled={submitting} className="gap-1.5">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Create ticket
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Field keys handled by first-class controls, so we don't double-render them. */
const DEFAULT_FIELD_KEYS = new Set([
  "summary", "priority", "description", "description_html", "assignee", "assigned_group", "group", "project", "ticket_type",
]);

function Stepper({ step }: { step: Step }) {
  const labels = ["Type", "Template", "Details"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const done = step > n;
        const active = step === n;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full text-xs font-semibold",
                done ? "bg-indigo-600 text-white" : active ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-500" : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-4 w-4" /> : n}
            </span>
            <span className={cn("text-sm", active ? "font-medium" : "text-muted-foreground")}>{label}</span>
            {i < labels.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function TemplateOption({
  active, title, description, onClick,
}: { active: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        active ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "hover:bg-muted",
      )}
    >
      <FileText className="mt-0.5 h-4 w-4 text-indigo-500" />
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>
      {active && <Check className="ml-auto h-4 w-4 text-indigo-600" />}
    </button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-destructive">{errors.join(" ")}</p>;
}

function DynamicField({
  field, value, error, users, groups, onChange,
}: {
  field: LayoutField;
  value: unknown;
  error?: string[];
  users: AccountUser[];
  groups: Group[];
  onChange: (v: unknown) => void;
}) {
  const id = `cf-${field.field_key}`;
  const label = (
    <Label htmlFor={id}>
      {field.field_name}
      {field.is_mandatory && <span className="text-destructive"> *</span>}
    </Label>
  );

  const options = normalizeOptions(field.options);

  let control: React.ReactNode;
  switch (field.field_type) {
    case "textarea":
    case "multiline":
      control = (
        <textarea
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
      break;
    case "number":
      control = <Input id={id} type="number" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
    case "datetime":
      control = (
        <Input id={id} type={field.field_type === "date" ? "date" : "datetime-local"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "checkbox":
    case "boolean":
      control = (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={Boolean(value)} onCheckedChange={(c) => onChange(Boolean(c))} /> {field.field_name}
        </label>
      );
      break;
    case "dropdown":
    case "select":
      control = (
        <Select value={(value as string) ?? ""} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "user":
      control = (
        <Select value={(value as string) ?? ""} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Select user…" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {users.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.full_name || u.username}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "group":
      control = (
        <Select value={(value as string) ?? ""} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Select group…" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    default:
      control = <Input id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="grid gap-1.5">
      {field.field_type !== "checkbox" && field.field_type !== "boolean" && label}
      {control}
      {field.help_text && <p className="text-xs text-muted-foreground">{field.help_text}</p>}
      <FieldError errors={error} />
    </div>
  );
}

function normalizeOptions(options?: LayoutField["options"]): { value: string; label: string }[] {
  if (!options) return [];
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}
