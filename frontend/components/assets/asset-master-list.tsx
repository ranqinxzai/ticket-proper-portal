"use client";

/**
 * Generic list + edit sheet for the org-wide asset masters (Vendors, Locations,
 * Departments). Configured per master with its fields and extra table columns.
 * All sub-components are module-level.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { FieldRow } from "@/components/settings/field-row";
import { EmptyState } from "@/components/shell/empty-state";
import { inputCls, textareaCls } from "@/components/tickets/field-styles";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { apiMessage, fieldErr } from "./asset-utils";
import { ConfirmDialog } from "./confirm-dialog";
import type { ConfigPerms } from "./category-tree-editor";

const NO_PERM = "You don't have permission to change Asset Configuration.";

export type MasterBase = { id: string; name: string; is_active: boolean; asset_count: number };

export type MasterField = {
  key: string;
  label: string;
  kind?: "text" | "email" | "url" | "tel" | "textarea";
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
};

/** Method syntax on purpose: the typed `masterApi<T, Input>` clients fit it (bivariant params). */
export type MasterApi<T> = {
  list(params?: { active?: boolean; search?: string }): Promise<T[]>;
  create(body: Record<string, unknown>): Promise<T>;
  update(id: string, body: Record<string, unknown>): Promise<T>;
  delete(id: string): Promise<void>;
};

export type MasterConfig<T> = {
  /** Singular noun, lower case ("vendor"). */
  noun: string;
  icon: LucideIcon;
  api: MasterApi<T>;
  /** Form fields after Name (Name is always first and required). */
  fields: MasterField[];
  /** Extra table columns after Name. */
  columns: { key: string; label: string }[];
};

type Values = Record<string, string>;

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function MasterSheet<T extends MasterBase>({
  config,
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  config: MasterConfig<T>;
  /** Edit when set; create otherwise. */
  item: T | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const baseId = useId();
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const rec = (item ?? {}) as Record<string, unknown>;
    const next: Values = { name: str(rec.name) };
    for (const f of config.fields) next[f.key] = str(rec[f.key]);
    setValues(next);
    setErrors({});
    setBusy(false);
  }, [open, item, config.fields]);

  async function save() {
    if (!values.name?.trim()) {
      setErrors({ name: ["Enter a name."] });
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) body[k] = v.trim();
    try {
      if (item) await config.api.update(item.id, body);
      else await config.api.create({ ...body, is_active: true });
      toast.success(item ? "Saved." : `${config.noun[0].toUpperCase()}${config.noun.slice(1)} added.`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ItsmApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(apiMessage(e, `Could not save the ${config.noun}.`));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, v: string) => setValues((cur) => ({ ...cur, [k]: v }));

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 p-0">
        <SheetHeader>
          <SheetTitle>{item ? `Edit ${config.noun}` : `New ${config.noun}`}</SheetTitle>
          <SheetDescription>{ASSET_HELP.sharedMasters}</SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <FieldRow label="Name" htmlFor={`${baseId}-name`} required error={fieldErr(errors, "name")}>
              <input
                id={`${baseId}-name`}
                className={inputCls}
                value={values.name ?? ""}
                maxLength={150}
                disabled={busy}
                autoFocus
                onChange={(e) => set("name", e.target.value)}
              />
            </FieldRow>
            {config.fields.map((f) => (
              <FieldRow key={f.key} label={f.label} htmlFor={`${baseId}-${f.key}`} required={f.required} error={fieldErr(errors, f.key)}>
                {f.kind === "textarea" ? (
                  <textarea
                    id={`${baseId}-${f.key}`}
                    rows={3}
                    className={textareaCls}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    disabled={busy}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    id={`${baseId}-${f.key}`}
                    type={f.kind ?? "text"}
                    className={inputCls}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    disabled={busy}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </FieldRow>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t bg-background px-5 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {item ? "Save changes" : `Add ${config.noun}`}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function AssetMasterList<T extends MasterBase>({ config, perms }: { config: MasterConfig<T>; perms: ConfigPerms }) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<T | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const { api, noun } = config;
  const plural = `${noun}s`;

  const load = useCallback(async () => {
    try {
      setRows(await api.list());
    } catch (e) {
      setRows((cur) => cur ?? []);
      toast.error(apiMessage(e, `Could not load the ${plural}.`));
    }
  }, [api, plural]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows || !needle) return rows ?? [];
    return rows.filter((r) => {
      const rec = r as unknown as Record<string, unknown>;
      return ["name", ...config.columns.map((c) => c.key)].some((k) => str(rec[k]).toLowerCase().includes(needle));
    });
  }, [rows, q, config.columns]);

  async function setActive(r: T, v: boolean) {
    setBusyId(r.id);
    try {
      await api.update(r.id, { is_active: v });
      setRows((cur) => (cur ?? []).map((x) => (x.id === r.id ? { ...x, is_active: v } : x)));
      toast.success(v ? `“${r.name}” activated.` : `“${r.name}” deactivated.`);
    } catch (e) {
      toast.error(apiMessage(e, `Could not update the ${noun}.`));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(deleting.id);
      toast.success(`“${deleting.name}” deleted.`);
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error(apiMessage(e, `Could not delete the ${noun}.`));
      void load();
    } finally {
      setDeleteBusy(false);
    }
  }

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const inUse = deleting ? deleting.asset_count > 0 : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${plural}…`}
            aria-label={`Search ${plural}`}
            className="pl-8"
          />
        </div>
        {perms.create ? (
          <Button size="sm" onClick={openNew}>
            <Plus aria-hidden="true" /> New {noun}
          </Button>
        ) : null}
      </div>

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={config.icon}
          title={`No ${plural} yet`}
          description={`${ASSET_HELP.sharedMasters} Imports can also create them (“Create missing vendors, locations and departments”).`}
          action={
            perms.create ? (
              <Button onClick={openNew}>
                <Plus aria-hidden="true" /> New {noun}
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No {plural} match “{q}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {config.columns.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
                <TableHead className="text-right">
                  <span className="inline-flex flex-row-reverse items-center gap-1">
                    Assets <InfoTip label="About the asset count">{ASSET_HELP.assetCount}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="inline-flex items-center gap-1">
                    Active <InfoTip label="About Active">{ASSET_HELP.masterActive(noun)}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const rec = r as unknown as Record<string, unknown>;
                return (
                  <TableRow key={r.id} className={cn(!r.is_active && "text-muted-foreground")}>
                    <TableCell className="font-medium">
                      <span className="block max-w-[18rem] truncate" title={r.name}>
                        {r.name}
                      </span>
                    </TableCell>
                    {config.columns.map((c) => {
                      const v = str(rec[c.key]);
                      return (
                        <TableCell key={c.key}>
                          <span className="block max-w-[16rem] truncate" title={v || undefined}>
                            {v || <span className="text-muted-foreground">—</span>}
                          </span>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right tabular-nums">{r.asset_count.toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <Hint label={perms.update ? undefined : NO_PERM}>
                        <Switch
                          checked={r.is_active}
                          disabled={!perms.update || busyId === r.id}
                          onCheckedChange={(v) => void setActive(r, v)}
                          aria-label={`Active: ${r.name}`}
                        />
                      </Hint>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {perms.update ? (
                          <IconButton
                            label={`Edit ${r.name}`}
                            className="h-8 w-8"
                            disabled={busyId === r.id}
                            onClick={() => {
                              setEditing(r);
                              setSheetOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                        ) : null}
                        {perms.delete ? (
                          <IconButton
                            label={`Delete ${r.name}`}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={busyId === r.id}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <MasterSheet
        config={config}
        item={editing}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={!!deleting}
        busy={deleteBusy}
        title={deleting ? `Delete “${deleting.name}”?` : ""}
        description={
          deleting
            ? inUse
              ? ASSET_HELP.masterDeleteInUse(deleting.asset_count, noun)
              : `It's removed from every helpdesk's pickers. This can't be undone.`
            : undefined
        }
        hideConfirm={inUse}
        extraAction={
          deleting && inUse && deleting.is_active && perms.update ? (
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => {
                const r = deleting;
                setDeleting(null);
                void setActive(r, false);
              }}
            >
              Deactivate instead
            </Button>
          ) : null
        }
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
