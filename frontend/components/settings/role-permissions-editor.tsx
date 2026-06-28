"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { rolesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { ItsmModule, SystemRole } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

function emptyBits(): Bits {
  return { can_read: false, can_create: false, can_update: false, can_delete: false };
}

/**
 * Editable grant matrix for one role: every permission module × CRUD. Modules
 * render as an indented tree (depth from the dot-notation code) sorted by the
 * server's `sort_order`, which already lists parents before children. Saving
 * sends the full matrix to PUT /roles/{id}/permissions/.
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

  const sorted = useMemo(
    () => [...modules].sort((a, b) => a.sort_order - b.sort_order),
    [modules],
  );

  // True tree depth via parent_code (a module's code dot-count can differ from
  // its real depth, e.g. itsm.canned_notes lives under itsm.tickets).
  const depthByCode = useMemo(() => {
    const byCode = new Map(modules.map((m) => [m.code, m]));
    const cache = new Map<string, number>();
    const depthOf = (code: string): number => {
      const cached = cache.get(code);
      if (cached !== undefined) return cached;
      const parentCode = byCode.get(code)?.parent_code;
      const parent = parentCode ? byCode.get(parentCode) : undefined;
      const d = parent ? depthOf(parent.code) + 1 : 0;
      cache.set(code, d);
      return d;
    };
    const out = new Map<string, number>();
    for (const m of modules) out.set(m.code, depthOf(m.code));
    return out;
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
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Module</th>
              {ACTIONS.map((a) => (
                <th key={a.key} className="w-16 px-2 py-2 text-center font-medium">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const depth = depthByCode.get(m.code) ?? 0;
              const bits = matrix[m.id] ?? emptyBits();
              return (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-1.5">
                    <span
                      style={{ paddingLeft: depth * 16 }}
                      className={depth === 0 ? "font-medium" : undefined}
                    >
                      {m.name}
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
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
