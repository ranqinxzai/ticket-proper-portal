"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { modulesApi, rolesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { ItsmModule, SystemRole } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { RolePermissionsEditor } from "./role-permissions-editor";

export function RolesList({ canManage }: { canManage: boolean }) {
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [modules, setModules] = useState<ItsmModule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SystemRole | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([rolesApi.list(), modulesApi.list()])
      .then(([rs, ms]) => {
        setRoles(rs);
        setModules(ms);
        setSelectedId((cur) => cur ?? rs[0]?.id ?? null);
      })
      .catch(() => {
        setRoles([]);
        setModules([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = roles.find((r) => r.id === selectedId) ?? null;

  function onRoleSaved(updated: SystemRole) {
    setRoles((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      await rolesApi.delete(deleting.id);
      toast.success("Role deleted.");
      setRoles((rs) => rs.filter((r) => r.id !== deleting.id));
      if (selectedId === deleting.id) setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not delete the role.");
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading roles…
      </p>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Roles
          </p>
          {canManage ? (
            <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" /> New
            </Button>
          ) : null}
        </div>
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm",
                  selectedId === r.id ? "border-primary bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.code}</span>
                </span>
                {r.is_system ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    Built-in
                  </Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 space-y-3">
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{selected.name}</h3>
                {selected.description ? (
                  <p className="text-sm text-muted-foreground">{selected.description}</p>
                ) : null}
              </div>
              {canManage && !selected.is_system ? (
                <Button variant="ghost" size="sm" onClick={() => setDeleting(selected)}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete role
                </Button>
              ) : null}
            </div>
            <RolePermissionsEditor
              key={selected.id}
              role={selected}
              modules={modules}
              canManage={canManage}
              onSaved={onRoleSaved}
            />
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Select a role to edit its permissions.
          </div>
        )}
      </div>

      <CreateRoleDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(r) => {
          setRoles((rs) => [...rs, r]);
          setSelectedId(r.id);
        }}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete role?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `"${deleting.name}" will be removed. Users assigned to it will lose its permissions.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={busy === deleting?.id}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={busy === deleting?.id}
            >
              {busy === deleting?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (role: SystemRole) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setCode("");
    setDescription("");
  }

  async function submit() {
    const finalCode = (code.trim() || name.trim())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!name.trim() || !finalCode) {
      toast.error("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const role = await rolesApi.create({
        name: name.trim(),
        code: finalCode,
        description: description.trim() || undefined,
      });
      toast.success("Role created.");
      onCreated(role);
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ItsmApiError
          ? e.fieldErrors?.code?.[0] ?? e.message
          : "Could not create the role.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            A custom role starts with no permissions — grant modules after creating it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nr-name">Name *</Label>
            <Input
              id="nr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team Lead"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nr-code">Code</Label>
            <Input
              id="nr-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="auto from name (e.g. team_lead)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nr-desc">Description</Label>
            <Input
              id="nr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
