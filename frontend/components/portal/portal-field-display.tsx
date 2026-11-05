"use client";

import type React from "react";

import { evalRule, hasNoChoices, normRule } from "@/components/tickets/ticket-create-form";
import { ExpandableHtml } from "@/components/ui/expandable-html";
import { InfoTip } from "@/components/ui/info-tip";
import { fieldHelp } from "@/lib/itsm/help/fields";
import type { FieldDefinition, FieldLayoutItem } from "@/lib/itsm/types";

/** maps_to standard columns rendered elsewhere on the page (summary = title,
 *  description = top block) — skipped here to avoid a double render. */
const SKIP_MAPS_TO = new Set(["summary", "description_html"]);

type Resolved = { item: FieldLayoutItem; def: FieldDefinition; value: unknown };
type Section = { name: string; rows: Resolved[] };

/** Read-only value node for one field, mirroring the agent ticket-detail
 *  formatter (option value → label, cascade "›", multiselect comma, checkbox
 *  Yes/No, richtext sanitized HTML). user_picker already arrives as a name. */
function formatValue(def: FieldDefinition, raw: unknown): React.ReactNode {
  const dash = <span className="text-muted-foreground">—</span>;
  if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return dash;
  const labelFor = (val: unknown) =>
    def.options?.find((o) => o.value === String(val))?.label ?? String(val);

  switch (def.field_type) {
    case "richtext":
      // Server-sanitised on write (field engine _coerce) → safe to render. Long
      // values show 6 lines + Show more.
      return <ExpandableHtml html={String(raw)} className="prose prose-sm max-w-none dark:prose-invert" />;
    case "multiline":
      return <p className="whitespace-pre-wrap">{String(raw)}</p>;
    case "cascade":
      return Array.isArray(raw) ? raw.map(labelFor).join(" › ") : labelFor(raw);
    case "multiselect":
      return Array.isArray(raw) ? raw.map(labelFor).join(", ") : labelFor(raw);
    case "dropdown":
    case "radio":
      return labelFor(raw);
    case "checkbox":
      return raw ? "Yes" : "No";
    case "user_picker":
      return String(raw); // backend resolved the id to a display name
    case "attachment":
      return dash; // file listing is out of scope for the portal detail
    case "asset_picker": {
      // Linked assets arrive as "TAG · Name" strings, the main one first.
      const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      return (
        <ul className="space-y-0.5">
          {list.map((a, i) => (
            <li key={`${a}-${i}`} className="truncate" title={a}>
              {a}
            </li>
          ))}
        </ul>
      );
    }
    default:
      return String(raw);
  }
}

/** Group resolved rows by section name, preserving order. */
function groupBySection(rows: Resolved[]): Section[] {
  const out: Section[] = [];
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
}

function Field({ def, value }: { def: FieldDefinition; value: unknown }) {
  const cfg = (def.config ?? {}) as { maps_to?: string; tooltip?: string; hint?: string };
  // Same tooltip (ⓘ) + hint text the portal create form (FieldControl) shows, so the
  // read-only detail mirrors the form's guidance instead of dropping it.
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {def.name}
        <InfoTip label={`What does ${def.name} mean?`} side="left">
          {fieldHelp(def)}
        </InfoTip>
      </dt>
      <dd className="mt-0.5 text-sm">{formatValue(def, value)}</dd>
      {cfg.hint ? <p className="mt-1 text-xs text-muted-foreground">{cfg.hint}</p> : null}
    </div>
  );
}

/** Read-only render of a ticket's portal-visible fields in the project's own
 *  layout (main grid + sidebar stack, in section/sort order). The backend has
 *  already clamped `layout.items` to portal_visible; this mirrors the portal
 *  create form so the detail "looks the same" but filled in and read-only. */
export function PortalFieldDisplay({
  layout,
  fields,
  values,
}: {
  layout: { items: FieldLayoutItem[] };
  fields: FieldDefinition[];
  values: Record<string, unknown>;
}) {
  const defsById: Record<string, FieldDefinition> = Object.fromEntries(fields.map((d) => [d.id, d]));

  const resolved: Resolved[] = (layout.items ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({ item, def: defsById[item.field], value: values[defsById[item.field]?.key] }))
    .filter((r) => r.def && !r.item.is_hidden && r.item.portal_visible !== false)
    // Honor conditional "show when …" rules, same as the portal create form — a
    // field whose condition isn't met must not leak onto the read-only detail.
    .filter((r) => evalRule(normRule(r.item.visibility_rule), values).visible)
    .filter((r) => !SKIP_MAPS_TO.has(((r.def.config ?? {}) as { maps_to?: string }).maps_to ?? ""))
    // Mirror the request form: a dropdown / cascading field with nothing to pick is
    // hidden there, so don't show it here as a permanent "—" either.
    .filter((r) => !(hasNoChoices(r.def) && (r.value == null || r.value === "" || (Array.isArray(r.value) && r.value.length === 0))))
    // The Asset field is only offered when the requestor has assets — no "—" without links.
    .filter((r) => !(r.def.field_type === "asset_picker" && (r.value == null || (Array.isArray(r.value) && r.value.length === 0))));

  const main = groupBySection(resolved.filter((r) => r.item.region !== "sidebar"));
  const side = groupBySection(resolved.filter((r) => r.item.region === "sidebar"));

  if (main.length === 0 && side.length === 0) return null;

  const hasSidebar = side.length > 0;

  return (
    <section aria-label="Request details" className="rounded-xl border bg-card p-4 shadow-soft">
      <h2 className="mb-3 text-sm font-semibold">Details</h2>
      <div className={hasSidebar ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]" : ""}>
        <dl className="space-y-6">
          {main.map((sec) => (
            <div key={sec.name} className="space-y-4">
              {main.length > 1 || sec.name !== "Details" ? (
                <p className="text-sm font-semibold text-muted-foreground">{sec.name}</p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {sec.rows.map((r) => (
                  <div
                    key={r.item.id}
                    className={
                      r.def.field_type === "richtext" || r.item.width !== "half"
                        ? "sm:col-span-2"
                        : "sm:col-span-1"
                    }
                  >
                    <Field def={r.def} value={r.value} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </dl>

        {hasSidebar ? (
          <aside className="space-y-4">
            {side.map((sec) => (
              <dl key={sec.name} className="space-y-4 rounded-lg border p-4">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {sec.name}
                </p>
                {sec.rows.map((r) => (
                  <Field key={r.item.id} def={r.def} value={r.value} />
                ))}
              </dl>
            ))}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
