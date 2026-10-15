"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlignLeft, Info, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ItsmApiError } from "@/lib/itsm/client";
import { allowedGroupsForProject } from "@/lib/itsm/groups";
import { computePriority } from "@/lib/itsm/priority";
import {
  fieldsApi,
  groupsApi,
  layoutsApi,
  ticketAttachmentsApi,
  ticketsApi,
  usersApi,
} from "@/lib/itsm/api";
import type {
  CreateTicketInput,
  FieldDefinition,
  FieldLayoutItem,
  FieldOption,
  FieldVisibilityRule,
  Group,
  Project,
  UserRef,
} from "@/lib/itsm/types";
import { GroupMemberPicker } from "./group-member-picker";
import { selectCls, textareaCls } from "./field-styles";
import { UserAvatar } from "./user-avatar";

export type Cfg = { maps_to?: string; tooltip?: string; hint?: string; regex?: string; regex_message?: string; levels?: string[]; depth?: number };

/** Built-in, requestor-friendly explanations for the severity fields so users
 *  (especially end-users raising a request) understand what Low/Medium/High/
 *  Critical mean. Rendered as a hover tooltip (ⓘ) next to the field label. */
export const FIELD_HELP: Record<string, string> = {
  impact:
    "How widely is this affecting work?\n• Low — one person, minor inconvenience\n• Medium — a team/department slowed down\n• High — many users or a whole site affected\n• Critical — business stopped, nothing works",
  urgency:
    "How quickly does this need fixing?\n• Low — can wait, no deadline\n• Medium — needed soon\n• High — work is blocked, fix ASAP",
  priority:
    "Overall priority = Impact × Urgency.\n• P1 Critical — major outage, act immediately\n• P2 High — significant impact\n• P3 Medium — moderate, a workaround exists\n• P4 Low — minor issue",
};
export type Values = Record<string, unknown>;

/** Normalize a stored visibility rule (supports the legacy {field, equals} shape). */
export function normRule(raw: unknown): FieldVisibilityRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.field) return null;
  return {
    action: r.action === "readonly" ? "readonly" : "show",
    field: String(r.field),
    operator: r.operator === "neq" ? "neq" : "eq",
    value: String(r.value ?? r.equals ?? ""),
  };
}

/** Evaluate a rule against current form values. Unknown condition fields (e.g. `status`,
 *  which has no value at creation) never match — so "show when status=on_hold" hides at create. */
export function evalRule(rule: FieldVisibilityRule | null, values: Values): { visible: boolean; readonly: boolean } {
  if (!rule) return { visible: true, readonly: false };
  const cv = values[rule.field];
  const has = cv !== undefined && cv !== null && cv !== "";
  const eq = has && String(cv) === String(rule.value);
  const matched = rule.operator === "neq" ? has && !eq : eq;
  if (rule.action === "readonly") return { visible: true, readonly: matched };
  return { visible: matched, readonly: false };
}

export const userId = (v: unknown): string | null =>
  v && typeof v === "object" && "id" in (v as object) ? String((v as UserRef).id) : null;

export function TicketCreateForm({ project }: { project: Project }) {
  const router = useRouter();
  const { org, helpdeskKey } = useWorkspace();
  const defaultType = project.ticket_types.find((t) => t.is_default) ?? project.ticket_types[0];

  // Ticket type is no longer a form control — it isn't part of the layout and
  // categories aren't managed in project config. New tickets silently use the
  // project's default type; it still drives layout resolution + the stored value.
  const [ticketType] = useState(defaultType?.id ?? "");
  const [items, setItems] = useState<FieldLayoutItem[]>([]);
  const [defsById, setDefsById] = useState<Record<string, FieldDefinition>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [values, setValues] = useState<Values>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Groups for group_picker fields (the helpdesk's groups).
  useEffect(() => {
    groupsApi.list({ helpdesk: project.helpdesk, is_active: true }).then(setGroups).catch(() => setGroups([]));
  }, [project.helpdesk]);

  // Constrain the assigned-group picker to the project's whitelist (if any).
  const allowedGroups = useMemo(() => allowedGroupsForProject(groups, project), [groups, project]);

  // Resolve the layout for the chosen type + load the field definitions.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      layoutsApi.resolve(project.id, ticketType || undefined),
      fieldsApi.list(project.id),
    ])
      .then(([layout, defList]) => {
        if (cancelled) return;
        const byId: Record<string, FieldDefinition> = {};
        for (const d of defList) byId[d.id] = d;
        setDefsById(byId);
        const its = (layout?.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
        setItems(its);
        setValues((prev) => {
          const next = { ...prev };
          for (const it of its) {
            const d = byId[it.field];
            if (!d || next[d.key] !== undefined) continue;
            if (d.default_json !== undefined && d.default_json !== null) next[d.key] = d.default_json;
            else if (d.key === "priority") next[d.key] = "p3";
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, ticketType]);

  const setVal = useCallback((key: string, v: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      // ITIL: Priority auto-derives from Impact × Urgency (live), but stays editable.
      if (key === "impact" || key === "urgency") {
        const derived = computePriority(
          project.priority_matrix, String(next.impact ?? ""), String(next.urgency ?? ""),
        );
        if (derived) next.priority = derived;
      }
      return next;
    });
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  }, [project.priority_matrix]);

  // Resolve each item's definition + visibility once per render.
  const resolved = useMemo(
    () =>
      items
        .filter((it) => !it.is_hidden && defsById[it.field])
        .map((it) => {
          const def = defsById[it.field];
          const { visible, readonly } = evalRule(normRule(it.visibility_rule), values);
          return { item: it, def, visible, readonly };
        })
        .filter((r) => r.visible),
    [items, defsById, values],
  );

  // Group visible items by region (main/sidebar) then section, preserving order.
  const grouped = useMemo(() => {
    const group = (rows: typeof resolved) => {
      const out: { name: string; rows: typeof resolved }[] = [];
      for (const r of rows) {
        const name = r.item.section || "Details";
        let sec = out.find((s) => s.name === name);
        if (!sec) {
          sec = { name, rows: [] };
          out.push(sec);
        }
        sec.rows.push(r);
      }
      return out;
    };
    return {
      main: group(resolved.filter((r) => r.item.region !== "sidebar")),
      side: group(resolved.filter((r) => r.item.region === "sidebar")),
    };
  }, [resolved]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const { item, def, readonly } of resolved) {
      // A required option-field with no options yet (e.g. an unconfigured Category
      // tree) can't be satisfied — don't block creation on a config gap.
      const optionField = def.field_type === "cascade" || def.field_type === "dropdown" || def.field_type === "radio";
      const noOptions = optionField && (def.options?.length ?? 0) === 0;
      if (!item.is_mandatory || readonly || noOptions) continue;
      const v = values[def.key];
      const empty =
        def.field_type === "attachment"
          ? (files[def.key]?.length ?? 0) === 0
          : def.field_type === "user_picker"
            ? !userId(v)
            : def.field_type === "cascade"
              ? !(Array.isArray(v) && v.length > 0)
              : v === undefined || v === null || String(v).trim() === "";
      if (empty) errs[def.key] = `${def.name} is required.`;
    }
    // regex (text-like)
    for (const { def } of resolved) {
      const cfg = (def.config ?? {}) as Cfg;
      if (!cfg.regex) continue;
      const v = values[def.key];
      if (v === undefined || v === null || String(v) === "") continue;
      try {
        if (!new RegExp(cfg.regex).test(String(v))) {
          errs[def.key] = cfg.regex_message || `${def.name} has an invalid format.`;
        }
      } catch {
        /* ignore bad pattern */
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketType) {
      toast.error("This project has no ticket type configured.");
      return;
    }
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const payload: CreateTicketInput = {
        project: project.id,
        ticket_type: ticketType,
        summary: "",
        source: "agent",
      };
      const custom: Record<string, unknown> = {};
      for (const { def } of resolved) {
        if (def.field_type === "attachment") continue;
        const cfg = (def.config ?? {}) as Cfg;
        let v: unknown = values[def.key];
        if (def.field_type === "user_picker") v = userId(v);
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
        if (cfg.maps_to) (payload as Record<string, unknown>)[cfg.maps_to] = v;
        else custom[def.key] = v;
      }
      if (!payload.summary) payload.summary = String(values["summary"] ?? "").trim();
      if (Object.keys(custom).length) payload.custom_fields = custom;

      const ticket = await ticketsApi.create(payload);

      // Upload attachments (after the ticket exists).
      const allFiles = Object.values(files).flat();
      if (allFiles.length) {
        await Promise.all(allFiles.map((f) => ticketAttachmentsApi.upload(ticket.id, f).catch(() => null)));
      }

      toast.success(`Created ${ticket.ticket_number}.`);
      router.push(`/t/${org}/agent/w/${helpdeskKey}/p/${project.key}/${ticket.ticket_number}`);
    } catch (err) {
      if (err instanceof ItsmApiError && err.fieldErrors) setErrors((e) => ({ ...e, ...mapApiErrors(err.fieldErrors!) }));
      toast.error(err instanceof ItsmApiError ? err.message : "Could not create the ticket.");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
      </p>
    );
  }

  // The currently-selected group (for the strict assignee picker).
  const groupFieldKey = resolved.find((r) => ((r.def.config ?? {}) as Cfg).maps_to === "assigned_group")?.def.key;
  const selectedGroupId = groupFieldKey ? ((values[groupFieldKey] as string) || null) : null;

  const renderField = (r: (typeof resolved)[number]) => (
    <FieldControl
      key={r.item.id}
      def={r.def}
      required={r.item.is_mandatory}
      readonly={r.readonly}
      value={values[r.def.key]}
      error={errors[r.def.key]}
      groups={allowedGroups}
      groupId={selectedGroupId}
      files={files[r.def.key] ?? []}
      onChange={(v) => setVal(r.def.key, v)}
      onFiles={(fs) => setFiles((p) => ({ ...p, [r.def.key]: fs }))}
    />
  );

  const hasSidebar = grouped.side.length > 0;

  return (
    <form onSubmit={submit} className="space-y-6 compact:space-y-4">
      {/* Type is intentionally not rendered — it isn't part of the field layout
          and categories aren't managed in project config. The default ticket
          type is sent silently (see `ticketType` above). */}
      <div className={hasSidebar ? "grid gap-6 compact:gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" : "mx-auto max-w-3xl"}>
        {/* Main column — each section is a structured card (header + field grid). */}
        <div className="space-y-6 compact:space-y-4">
          {grouped.main.map((sec) => {
            return (
              <section
                key={sec.name}
                className="overflow-hidden rounded-xl border bg-card shadow-soft transition-shadow duration-200 hover:shadow-soft-md"
              >
                <header className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3.5 compact:px-3.5 compact:py-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground compact:h-6 compact:w-6">
                    <AlignLeft className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">{sec.name}</h3>
                </header>
                <fieldset className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2 sm:p-6 compact:gap-3.5 compact:p-3.5">
                  {sec.rows.map((r) => (
                    <div
                      key={r.item.id}
                      className={r.def.field_type === "richtext" || r.item.width !== "half" ? "sm:col-span-2" : "sm:col-span-1"}
                    >
                      {renderField(r)}
                    </div>
                  ))}
                </fieldset>
              </section>
            );
          })}
        </div>

        {/* Sidebar column (properties) — sticky panel that follows long forms. */}
        {hasSidebar ? (
          <aside className="space-y-4 compact:space-y-3 lg:sticky lg:top-rail lg:self-start">
            {grouped.side.map((sec) => (
              <fieldset
                key={sec.name}
                className="space-y-4 rounded-xl border bg-card p-5 shadow-soft transition-shadow duration-200 hover:shadow-soft-md compact:space-y-3 compact:p-3.5"
              >
                <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  {sec.name}
                </legend>
                {sec.rows.map((r) => renderField(r))}
              </fieldset>
            ))}
          </aside>
        ) : null}
      </div>

      {/* Sticky action bar — full-bleed (`-mx-main-x` cancels <main>'s gutter), always
          reachable (mirrors the queue pager). */}
      <div className="sticky bottom-0 z-30 -mx-main-x flex items-center justify-end gap-2 border-t bg-card/95 px-main-x py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 compact:py-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="bg-gradient-to-br from-primary to-chart-4 text-white shadow-soft-md transition hover:shadow-soft-lg hover:brightness-[1.05]"
        >
          {busy ? "Creating…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}

export function mapApiErrors(bag: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag)) out[k] = v?.[0] ?? "Invalid value.";
  return out;
}

// ---- per-field control ----------------------------------------------------

export function FieldControl({
  def,
  required,
  readonly,
  value,
  error,
  groups,
  groupId,
  files,
  onChange,
  onFiles,
}: {
  def: FieldDefinition;
  required: boolean;
  readonly: boolean;
  value: unknown;
  error?: string;
  groups: Group[];
  groupId: string | null;
  files: File[];
  onChange: (v: unknown) => void;
  onFiles: (f: File[]) => void;
}) {
  const cfg = (def.config ?? {}) as Cfg;
  const fieldId = `f-${def.id}`;
  const control = renderInput();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={fieldId}>
          {def.name}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {(() => {
          const help = cfg.tooltip || FIELD_HELP[cfg.maps_to ?? ""] || FIELD_HELP[def.key ?? ""];
          return help ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`What does ${def.name} mean?`}
                  className="cursor-help text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs whitespace-pre-line text-left leading-relaxed">
                {help}
              </TooltipContent>
            </Tooltip>
          ) : null;
        })()}
      </div>
      {control}
      {cfg.hint ? <p className="text-xs text-muted-foreground">{cfg.hint}</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );

  function renderInput() {
    const disabled = readonly;
    // Strict assignment: the assignee system field draws from the chosen group's members.
    if (cfg.maps_to === "assignee") {
      return (
        <GroupMemberPicker
          groupId={groupId}
          value={(value as UserRef | null) ?? null}
          disabled={disabled}
          className={selectCls}
          onChange={onChange}
        />
      );
    }
    switch (def.field_type) {
      case "richtext":
        return (
          <RichTextEditor
            value={String(value ?? "")}
            disabled={disabled}
            placeholder={def.key === "description" ? "Describe the issue…" : `Enter ${def.name.toLowerCase()}…`}
            ariaLabel={def.name}
            onChange={(html) => onChange(html)}
          />
        );
      case "multiline":
        return (
          <textarea
            id={fieldId}
            value={String(value ?? "")}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            rows={6}
            className={textareaCls}
          />
        );
      case "number":
        return (
          <Input id={fieldId} type="number" disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        );
      case "date":
        return (
          <Input id={fieldId} type="date" disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        );
      case "datetime":
        return (
          <Input id={fieldId} type="datetime-local" disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        );
      case "checkbox":
        return (
          <input id={fieldId} type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        );
      case "dropdown":
      case "radio":
        return (
          <select id={fieldId} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={selectCls}>
            <option value="">{`Select ${def.name.toLowerCase()}…`}</option>
            {(def.options ?? []).filter((o) => o.is_active !== false).map((o) => (
              <option key={o.id} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "group_picker":
        return (
          <select id={fieldId} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={selectCls}>
            <option value="">Unassigned</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        );
      case "user_picker":
        return <UserPickerField value={value as UserRef | null} disabled={disabled} onChange={onChange} />;
      case "cascade":
        return <CascadeField def={def} value={(value as string[]) ?? []} disabled={disabled} onChange={onChange} />;
      case "attachment":
        return <AttachmentField files={files} disabled={disabled} onFiles={onFiles} />;
      case "text":
      default:
        return (
          <Input
            id={fieldId}
            disabled={disabled}
            value={String(value ?? "")}
            maxLength={def.field_type === "text" ? 500 : undefined}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.key === "summary" ? "Short, specific title" : ""}
          />
        );
    }
  }
}

// ---- user picker (async search) -------------------------------------------

function UserPickerField({
  value,
  disabled,
  onChange,
}: {
  value: UserRef | null;
  disabled?: boolean;
  onChange: (v: UserRef | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserRef[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => {
      usersApi.search(q).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(h);
  }, [q, open]);

  if (value) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <UserAvatar user={value} size="sm" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium leading-tight">{value.full_name || value.username}</span>
          {value.email ? (
            <span className="truncate text-xs leading-tight text-muted-foreground">{value.email}</span>
          ) : null}
        </span>
        {!disabled ? (
          <button type="button" aria-label="Clear" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onChange(null)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={q}
        disabled={disabled}
        placeholder="Search people…"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(u);
                  setOpen(false);
                  setQ("");
                }}
              >
                <UserAvatar user={u} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate leading-tight">{u.full_name || u.username}</span>
                  {u.email ? (
                    <span className="truncate text-xs leading-tight text-muted-foreground">{u.email}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---- cascade (dependent dropdowns) ----------------------------------------

function CascadeField({
  def,
  value,
  disabled,
  onChange,
}: {
  def: FieldDefinition;
  value: string[];
  disabled?: boolean;
  onChange: (v: string[]) => void;
}) {
  const cfg = (def.config ?? {}) as Cfg;
  const levels = cfg.levels?.length ? cfg.levels : ["Category"];
  const options = def.options ?? [];
  const byValue = useMemo(() => {
    const m = new Map<string, FieldOption>();
    for (const o of options) m.set(o.value, o);
    return m;
  }, [options]);

  function childrenAt(level: number): FieldOption[] {
    if (level === 0) return options.filter((o) => !o.parent);
    const parentVal = value[level - 1];
    const parent = parentVal ? byValue.get(parentVal) : undefined;
    if (!parent) return [];
    return options.filter((o) => o.parent === parent.id);
  }

  const rendered: number[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (i === 0 || (value[i - 1] && childrenAt(i).length > 0)) rendered.push(i);
  }

  return (
    <div className="space-y-2">
      {rendered.map((i) => {
        const opts = childrenAt(i);
        // Sub-levels (i > 0) are indented with a connector so the dependent
        // choice (e.g. Network → VPN) visibly reads as a sub-category.
        const levelLabel = levels[i] ?? (i === 0 ? "Category" : "Sub-category");
        return (
          <div key={i} className={i > 0 ? "ml-2 border-l-2 border-border pl-3" : ""}>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{levelLabel}</label>
            <select
              disabled={disabled}
              value={value[i] ?? ""}
              onChange={(e) => {
                const next = value.slice(0, i);
                if (e.target.value) next[i] = e.target.value;
                onChange(next);
              }}
              className={selectCls}
              aria-label={levelLabel}
            >
              <option value="">{`Select ${levelLabel.toLowerCase()}…`}</option>
              {opts.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options configured yet.</p>
      ) : null}
    </div>
  );
}

// ---- attachments ----------------------------------------------------------

function AttachmentField({
  files,
  disabled,
  onFiles,
}: {
  files: File[];
  disabled?: boolean;
  onFiles: (f: File[]) => void;
}) {
  return (
    <div className="space-y-2">
      <label
        className={`flex items-center gap-3 rounded-xl border border-dashed border-input bg-muted/20 px-4 py-3.5 text-sm text-muted-foreground transition-colors ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <UploadCloud className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="flex flex-col">
          <span className="font-medium text-foreground">Choose files or drop here</span>
          <span className="text-xs">Attach screenshots, logs or documents</span>
        </span>
        <input
          type="file"
          multiple
          disabled={disabled}
          onChange={(e) => onFiles([...files, ...Array.from(e.target.files ?? [])])}
          className="sr-only"
        />
      </label>
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-xs">
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-muted-foreground">{Math.ceil(f.size / 1024)} KB</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
