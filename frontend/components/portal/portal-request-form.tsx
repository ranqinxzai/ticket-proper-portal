"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Cfg,
  FieldControl,
  evalRule,
  mapApiErrors,
  normRule,
  Values,
} from "@/components/tickets/ticket-create-form";
import { Button } from "@/components/ui/button";
import { ItsmApiError } from "@/lib/itsm/client";
import { portalApi } from "@/lib/itsm/api";
import type { FieldDefinition, FieldLayoutItem, Project } from "@/lib/itsm/types";

/** Synthetic Summary + Description fields used when a project has no layout, so the
 *  portal form still collects the essentials (the backend accepts these field keys). */
function fallbackFields(projectId: string): FieldDefinition[] {
  const base = { project: projectId, is_system: true, is_multi: false, options: [] };
  return [
    { ...base, id: "_summary", key: "summary", name: "Summary", field_type: "text", config: { maps_to: "summary" } },
    {
      ...base, id: "_description", key: "description", name: "Description",
      field_type: "richtext", config: { maps_to: "description_html" },
    },
  ];
}

function fallbackItems(): FieldLayoutItem[] {
  return [
    { id: "_summary", layout: "_", field: "_summary", sort_order: 0, is_hidden: false, portal_visible: true, is_mandatory: true, section: "Details", region: "main", width: "full" },
    { id: "_description", layout: "_", field: "_description", sort_order: 1, is_hidden: false, portal_visible: true, is_mandatory: false, section: "Details", region: "main", width: "full" },
  ];
}

/** End-user request form. Renders a project's configured layout (reusing the agent
 *  `FieldControl`) but wired to the portal intake API: only portal-visible fields
 *  (per the Layout designer's Portal toggle; assignment/source/pickers off by default),
 *  summary+description fallback when no layout exists, and on success it raises
 *  `onCreated(ticket)` rather than navigating. */
export function PortalRequestForm({
  project,
  onCreated,
}: {
  project: Project;
  onCreated: (ticket: { id: string; ticket_number: string }) => void;
}) {
  const defaultType = project.ticket_types.find((t) => t.is_default) ?? project.ticket_types[0];
  const ticketType = defaultType?.id ?? "";

  const [items, setItems] = useState<FieldLayoutItem[]>([]);
  const [defsById, setDefsById] = useState<Record<string, FieldDefinition>>({});
  const [values, setValues] = useState<Values>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    portalApi
      .resolveLayout(project.id, ticketType || undefined)
      .then(({ layout, fields }) => {
        if (cancelled) return;
        const byId: Record<string, FieldDefinition> = {};
        for (const d of fields) byId[d.id] = d;

        let its = (layout?.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
        if (its.length === 0) {
          // No configured layout → collect at least Summary + Description.
          for (const d of fallbackFields(project.id)) byId[d.id] = d;
          its = fallbackItems();
        }
        setDefsById(byId);
        setItems(its);
        setValues((prev) => {
          const next = { ...prev };
          for (const it of its) {
            const d = byId[it.field];
            if (!d || next[d.key] !== undefined) continue;
            if (d.default_json !== undefined && d.default_json !== null) next[d.key] = d.default_json;
            else if (d.key === "priority") next[d.key] = "medium";
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setDefsById(Object.fromEntries(fallbackFields(project.id).map((d) => [d.id, d])));
          setItems(fallbackItems());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, ticketType]);

  const setVal = useCallback((key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  }, []);

  // Resolve definitions + visibility; drop hidden, non-portal-visible, and rule-hidden
  // fields. The backend already clamps the layout to portal_visible items (assignment /
  // source / pickers are flagged off by default); this is a client safety net + honours
  // any per-field Portal toggle set in the Layout designer.
  const resolved = useMemo(
    () =>
      items
        .filter((it) => !it.is_hidden && it.portal_visible !== false && defsById[it.field])
        .map((it) => {
          const def = defsById[it.field];
          const { visible, readonly } = evalRule(normRule(it.visibility_rule), values);
          return { item: it, def, visible, readonly };
        })
        .filter((r) => r.visible),
    [items, defsById, values],
  );

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
      const optionField =
        def.field_type === "cascade" || def.field_type === "dropdown" || def.field_type === "radio";
      const noOptions = optionField && (def.options?.length ?? 0) === 0;
      if (!item.is_mandatory || readonly || noOptions) continue;
      const v = values[def.key];
      const empty =
        def.field_type === "attachment"
          ? (files[def.key]?.length ?? 0) === 0
          : def.field_type === "cascade"
            ? !(Array.isArray(v) && v.length > 0)
            : v === undefined || v === null || String(v).trim() === "";
      if (empty) errs[def.key] = `${def.name} is required.`;
    }
    for (const { def } of resolved) {
      const cfg = (def.config ?? {}) as Cfg;
      if (!cfg.regex) continue;
      const v = values[def.key];
      if (v === undefined || v === null || String(v) === "") continue;
      try {
        if (!new RegExp(cfg.regex).test(String(v)))
          errs[def.key] = cfg.regex_message || `${def.name} has an invalid format.`;
      } catch {
        /* ignore bad pattern */
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      // One dict keyed by field key — the backend resolves maps_to → standard
      // column vs custom field (assignment/source are never honoured server-side).
      const fields: Record<string, unknown> = {};
      for (const { def } of resolved) {
        if (def.field_type === "attachment") continue;
        const v = values[def.key];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
        fields[def.key] = v;
      }

      const ticket = await portalApi.createRequest({
        helpdesk: project.helpdesk,
        project: project.id,
        fields,
      });

      const allFiles = Object.values(files).flat();
      if (allFiles.length) {
        await Promise.all(
          allFiles.map((f) => portalApi.uploadRequestAttachment(ticket.ticket_number, f).catch(() => null)),
        );
      }
      onCreated(ticket);
    } catch (err) {
      if (err instanceof ItsmApiError && err.fieldErrors)
        setErrors((e) => ({ ...e, ...mapApiErrors(err.fieldErrors!) }));
      toast.error(err instanceof ItsmApiError ? err.message : "Could not submit your request.");
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

  const renderField = (r: (typeof resolved)[number]) => (
    <FieldControl
      key={r.item.id}
      def={r.def}
      required={r.item.is_mandatory}
      readonly={r.readonly}
      value={values[r.def.key]}
      error={errors[r.def.key]}
      groups={[]}
      groupId={null}
      files={files[r.def.key] ?? []}
      onChange={(v) => setVal(r.def.key, v)}
      onFiles={(fs) => setFiles((p) => ({ ...p, [r.def.key]: fs }))}
    />
  );

  const hasSidebar = grouped.side.length > 0;

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className={hasSidebar ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" : "mx-auto max-w-2xl"}>
        {/* Main column — each section a friendly, roomy card. */}
        <div className="space-y-6">
          {grouped.main.map((sec) => {
            const showHeader = grouped.main.length > 1 || sec.name !== "Details";
            return (
              <section key={sec.name} className="overflow-hidden rounded-xl border bg-card shadow-soft">
                {showHeader ? (
                  <header className="border-b bg-muted/30 px-5 py-3">
                    <h3 className="text-sm font-semibold text-foreground">{sec.name}</h3>
                  </header>
                ) : null}
                <fieldset className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
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

        {hasSidebar ? (
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {grouped.side.map((sec) => (
              <fieldset key={sec.name} className="space-y-4 rounded-xl border bg-card p-5 shadow-soft">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {sec.name}
                </legend>
                {sec.rows.map((r) => renderField(r))}
              </fieldset>
            ))}
          </aside>
        ) : null}
      </div>

      {/* Friendly floating action bar. */}
      <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <p className="text-xs text-muted-foreground">We&rsquo;ll email you updates on this request.</p>
        <Button type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}
