"use client";

import { useEffect, useMemo, useState } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Info, Loader2, Minus } from "lucide-react";

import { rolesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { ItsmModule, ItsmModuleCategory, SystemRole } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

type Bits = {
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
};

const ACTIONS: { key: keyof Bits; label: string }[] = [
  { key: "can_read", label: "Read" },
  { key: "can_create", label: "Create" },
  { key: "can_update", label: "Update" },
  { key: "can_delete", label: "Delete" },
];

// Rendered top-to-bottom. Splits the module tree into the two buckets the role
// admin actually reasons about: screens the role *uses* vs. settings it configures.
const SECTIONS: { key: ItsmModuleCategory; title: string; hint: string }[] = [
  {
    key: "operations",
    title: "Screens & Features",
    hint: "What this role can see and do in the app. Turning these off hides screens from the role.",
  },
  {
    key: "administration",
    title: "Settings & Administration",
    hint: "Configuration and admin surfaces. Turning these off only removes settings access, not day-to-day screens.",
  },
];

function emptyBits(): Bits {
  return { can_read: false, can_create: false, can_update: false, can_delete: false };
}

/** Tri-state checkbox for the per-section "grant all" header (dash when partial). */
function TriCheckbox({
  checked,
  disabled,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean | "indeterminate";
  disabled?: boolean;
  onCheckedChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={ariaLabel}
      className="peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {checked === "indeterminate" ? (
          <Minus className="h-3.5 w-3.5" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/**
 * Editable grant matrix for one role: every permission module × CRUD. Modules are
 * split into two labeled sections — "Screens & Features" (operational) and
 * "Settings & Administration" (config) — so an admin can tell an actual-screen
 * permission from a settings one at a glance. Within a section, children indent
 * under their parent (depth is measured against the codes present in that section,
 * so a settings child of an operational parent renders as its own section root).
 * Module descriptions surface as hover tooltips. Saving sends the full matrix to
 * PUT /roles/{id}/permissions/ exactly as before.
 */
export function RolePermissionsEditor({
  role,
  modules,
  canManage,
  onSaved,
}: {
  role: SystemRole;
  modules: ItsmModule[];
  canManage: boolean;
  onSaved: (role: SystemRole) => void;
}) {
  const [matrix, setMatrix] = useState<Record<string, Bits>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Modules grouped by category, each sorted by the server's sort_order (which
  // already lists parents before children). Unknown/missing category ⇒ operations.
  const grouped = useMemo(() => {
    const by: Record<ItsmModuleCategory, ItsmModule[]> = {
      operations: [],
      administration: [],
    };
    for (const m of modules) (by[m.category] ?? by.operations).push(m);
    for (const key of Object.keys(by) as ItsmModuleCategory[]) {
      by[key].sort((a, b) => a.sort_order - b.sort_order);
    }
    return by;
  }, [modules]);

  // Depth WITHIN a section: count ancestors that are also present in this section.
  const depthWithin = useMemo(() => {
    const byCode = new Map(modules.map((m) => [m.code, m]));
    return (m: ItsmModule, codesInSection: Set<string>): number => {
      let depth = 0;
      let cur: string | null | undefined = m.parent_code;
      while (cur && codesInSection.has(cur)) {
        depth += 1;
        cur = byCode.get(cur)?.parent_code;
      }
      return depth;
    };
  }, [modules]);

  useEffect(() => {
    const next: Record<string, Bits> = {};
    for (const m of modules) next[m.id] = emptyBits();
    for (const p of role.permissions ?? []) {
      next[p.module] = {
        can_read: p.can_read,
        can_create: p.can_create,
        can_update: p.can_update,
        can_delete: p.can_delete,
      };
    }
    setMatrix(next);
    setDirty(false);
  }, [role, modules]);

  function toggle(moduleId: string, key: keyof Bits, value: boolean) {
    setMatrix((mx) => ({ ...mx, [moduleId]: { ...(mx[moduleId] ?? emptyBits()), [key]: value } }));
    setDirty(true);
  }

  function sectionState(mods: ItsmModule[], key: keyof Bits): boolean | "indeterminate" {
    if (mods.length === 0) return false;
    const on = mods.filter((m) => (matrix[m.id] ?? emptyBits())[key]).length;
    if (on === 0) return false;
    if (on === mods.length) return true;
    return "indeterminate";
  }

  function toggleSection(mods: ItsmModule[], key: keyof Bits, value: boolean) {
    setMatrix((mx) => {
      const next = { ...mx };
      for (const m of mods) next[m.id] = { ...(next[m.id] ?? emptyBits()), [key]: value };
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const rows = modules.map((m) => ({ module: m.id, ...(matrix[m.id] ?? emptyBits()) }));
      const updated = await rolesApi.setPermissions(role.id, rows);
      toast.success("Permissions saved.");
      setDirty(false);
      onSaved(updated);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save permissions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {SECTIONS.map((section) => {
          const mods = grouped[section.key];
          if (mods.length === 0) return null;
          const codesInSection = new Set(mods.map((m) => m.code));
          return (
            <div key={section.key} className="space-y-2">
              <div>
                <h4 className="text-sm font-semibold">{section.title}</h4>
                <p className="text-xs text-muted-foreground">{section.hint}</p>
              </div>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a.key} className="w-16 px-2 py-2 text-center font-medium">
                          <div className="flex flex-col items-center gap-1">
                            <span>{a.label}</span>
                            {canManage ? (
                              <TriCheckbox
                                checked={sectionState(mods, a.key)}
                                disabled={saving}
                                onCheckedChange={(v) => toggleSection(mods, a.key, v)}
                                ariaLabel={`${section.title} — grant ${a.label} to all`}
                              />
                            ) : null}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mods.map((m) => {
                      const depth = depthWithin(m, codesInSection);
                      const bits = matrix[m.id] ?? emptyBits();
                      return (
                        <tr key={m.id} className="border-t">
                          <td className="px-3 py-1.5">
                            <span
                              style={{ paddingLeft: depth * 16 }}
                              className={
                                depth === 0
                                  ? "inline-flex items-center gap-1 font-medium"
                                  : "inline-flex items-center gap-1"
                              }
                            >
                              {m.name}
                              {m.description ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-foreground"
                                      aria-label={`About ${m.name}`}
                                    >
                                      <Info className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    {m.description}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </span>
                          </td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} className="px-2 py-1.5 text-center">
                              <Checkbox
                                checked={bits[a.key]}
                                disabled={!canManage || saving}
                                onCheckedChange={(v) => toggle(m.id, a.key, Boolean(v))}
                                aria-label={`${m.name} — ${a.label}`}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {canManage ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
