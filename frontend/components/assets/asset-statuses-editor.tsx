"use client";

/**
 * Configuration → Asset Configuration → Statuses (org-wide). Each status maps to a fixed
 * state type; one is the default, at most one Retired-type status is the Expired target.
 * All sub-components are module-level.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ColorPicker } from "@/components/settings/color-picker";
import { FieldRow } from "@/components/settings/field-row";
import { EmptyState } from "@/components/shell/empty-state";
import { inputCls, selectCls, textareaCls } from "@/components/tickets/field-styles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assetStatusesApi } from "@/lib/itsm/assets-api";
import { ASSET_STATE_TYPES, type AssetStateType, type AssetStatus } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP, ASSET_STATE_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { apiMessage, fieldErr } from "./asset-utils";
import { ConfirmDialog } from "./confirm-dialog";
import type { ConfigPerms } from "./category-tree-editor";

const NO_PERM = "You don't have permission to change Asset Configuration.";

type Draft = { id?: string; name: string; state_type: AssetStateType; color: string; description: string };

function StatusDialog({
  draft,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Draft | null>(draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(draft);
    setErrors({});
    setBusy(false);
  }, [draft]);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) {
      setErrors({ name: ["Enter a name."] });
      return;
    }
    setBusy(true);
    const body = {
      name: form.name.trim(),
      state_type: form.state_type,
      color: form.color,
      description: form.description.trim(),
    };
    try {
      if (form.id) await assetStatusesApi.update(form.id, body);
      else await assetStatusesApi.create({ ...body, sort_order: nextSortOrder });
      toast.success(form.id ? "Status saved." : "Status added.");
      onSaved();
    } catch (e) {
      if (e instanceof ItsmApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(apiMessage(e, "Could not save the status."));
      setBusy(false);
    }
  }

  const patch = (p: Partial<Draft>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit status" : "New status"}</DialogTitle>
          <DialogDescription>{ASSET_HELP.sharedMasters}</DialogDescription>
        </DialogHeader>
        {form ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <FieldRow label="Name" htmlFor="st-name" required error={fieldErr(errors, "name")}>
              <input
                id="st-name"
                className={inputCls}
                value={form.name}
                maxLength={60}
                disabled={busy}
                autoFocus
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="e.g. In Repair"
              />
            </FieldRow>
            <FieldRow
              label="State type"
              htmlFor="st-type"
              info={ASSET_HELP.stateType}
              hint={ASSET_STATE_HELP[form.state_type]}
              error={fieldErr(errors, "state_type") ?? fieldErr(errors, "auto_expire_target")}
            >
              <select
                id="st-type"
                className={selectCls}
                value={form.state_type}
                disabled={busy}
                onChange={(e) => patch({ state_type: e.target.value as AssetStateType })}
              >
                {ASSET_STATE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Colour" error={fieldErr(errors, "color")}>
              <ColorPicker value={form.color} onChange={(c) => patch({ color: c })} disabled={busy} />
            </FieldRow>
            <FieldRow label="Description" htmlFor="st-desc" error={fieldErr(errors, "description")}>
              <textarea
                id="st-desc"
                rows={2}
                className={textareaCls}
                value={form.description}
                disabled={busy}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </FieldRow>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {draft?.id ? "Save" : "Add status"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AssetStatusesEditor({ perms }: { perms: ConfigPerms }) {
  const [rows, setRows] = useState<AssetStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<AssetStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await assetStatusesApi.list();
      setRows([...r].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
    } catch (e) {
      setRows((cur) => cur ?? []);
      toast.error(apiMessage(e, "Could not load the statuses."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(apiMessage(e, "Could not save the change."));
      return false;
    } finally {
      await load();
      setBusy(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    if (!rows) return;
    const list = [...rows];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    const updates = list.map((s, i) => ({ s, order: (i + 1) * 10 })).filter(({ s, order }) => s.sort_order !== order);
    void run(() => Promise.all(updates.map(({ s, order }) => assetStatusesApi.update(s.id, { sort_order: order }))));
  }

  if (rows === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-lg" />
        ))}
      </div>
    );
  }

  const deleteBlocked = deleting ? deleting.is_default || deleting.asset_count > 0 : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "status" : "statuses"}
          <InfoTip label="About state types">{ASSET_HELP.stateType}</InfoTip>
        </p>
        {perms.create ? (
          <Button
            size="sm"
            onClick={() => setDraft({ name: "", state_type: "available", color: "#64748b", description: "" })}
          >
            <Plus aria-hidden="true" /> New status
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Tags} title="No statuses" description={ASSET_HELP.noStatuses} />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-card shadow-soft", busy && "opacity-70")} aria-busy={busy}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">
                  <span className="inline-flex items-center gap-1">
                    Order <InfoTip label="About order">{ASSET_HELP.statusOrder}</InfoTip>
                  </span>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    State type <InfoTip label="About state type">{ASSET_HELP.stateType}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="inline-flex items-center gap-1">
                    Default <InfoTip label="About the default status">{ASSET_HELP.statusDefault}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="inline-flex items-center gap-1">
                    Expired target <InfoTip label="About the Expired target">{ASSET_HELP.statusExpiredTarget}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex flex-row-reverse items-center gap-1">
                    Assets <InfoTip label="About the asset count">{ASSET_HELP.assetCount}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center">
                      <IconButton
                        label={`Move ${s.name} up`}
                        className="h-7 w-7"
                        disabled={!perms.update || busy || i === 0}
                        disabledReason={!perms.update ? NO_PERM : "Already first"}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Move ${s.name} down`}
                        className="h-7 w-7"
                        disabled={!perms.update || busy || i === rows.length - 1}
                        disabledReason={!perms.update ? NO_PERM : "Already last"}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-medium">{s.name}</p>
                        {s.description ? (
                          <p className="max-w-[20rem] truncate text-xs text-muted-foreground" title={s.description}>
                            {s.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Hint label={perms.update ? ASSET_STATE_HELP[s.state_type] : NO_PERM}>
                      <select
                        aria-label={`State type of ${s.name}`}
                        className={cn(selectCls, "h-8 w-44")}
                        value={s.state_type}
                        disabled={!perms.update || busy}
                        onChange={(e) =>
                          void run(() => assetStatusesApi.update(s.id, { state_type: e.target.value as AssetStateType }))
                        }
                      >
                        {ASSET_STATE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </Hint>
                  </TableCell>
                  <TableCell className="text-center">
                    <Hint
                      label={
                        s.is_default
                          ? "This is the default status."
                          : perms.update
                            ? `Make “${s.name}” the default`
                            : NO_PERM
                      }
                    >
                      <input
                        type="radio"
                        name="asset-default-status"
                        aria-label={`Default status: ${s.name}`}
                        className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                        checked={s.is_default}
                        disabled={!perms.update || busy}
                        onChange={() => void run(() => assetStatusesApi.update(s.id, { is_default: true }), `“${s.name}” is now the default.`)}
                      />
                    </Hint>
                  </TableCell>
                  <TableCell className="text-center">
                    {s.state_type === "retired" ? (
                      <Hint label={perms.update ? ASSET_HELP.statusExpiredTarget : NO_PERM}>
                        <Switch
                          checked={s.auto_expire_target}
                          disabled={!perms.update || busy}
                          aria-label={`Expired target: ${s.name}`}
                          onCheckedChange={(v) =>
                            void run(
                              () => assetStatusesApi.update(s.id, { auto_expire_target: v }),
                              v ? `Expired assets now move to “${s.name}”.` : "No Expired target: the hourly job won't move expired assets.",
                            )
                          }
                        />
                      </Hint>
                    ) : (
                      <Hint label={ASSET_HELP.statusExpiredTargetOnlyRetired} wrap>
                        <span className="text-muted-foreground">—</span>
                      </Hint>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.asset_count.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {perms.update ? (
                        <IconButton
                          label={`Edit ${s.name}`}
                          className="h-8 w-8"
                          disabled={busy}
                          onClick={() =>
                            setDraft({
                              id: s.id,
                              name: s.name,
                              state_type: s.state_type,
                              color: s.color,
                              description: s.description ?? "",
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      ) : null}
                      {perms.delete ? (
                        <IconButton
                          label={`Delete ${s.name}`}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => setDeleting(s)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <StatusDialog
        draft={draft}
        nextSortOrder={((rows[rows.length - 1]?.sort_order ?? 0) + 10)}
        onClose={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          void load();
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        busy={busy}
        title={deleting ? `Delete the status “${deleting.name}”?` : ""}
        description={
          deleting
            ? deleting.is_default
              ? "This is the default status, so it can't be deleted. Make another status the default first."
              : deleting.asset_count > 0
                ? ASSET_HELP.masterDeleteInUse(deleting.asset_count, "status").replace(/ Deactivate it instead.*$/, " Move those assets to another status first.")
                : "It's removed from pickers and filters. This can't be undone."
            : undefined
        }
        hideConfirm={deleteBlocked}
        onConfirm={() => {
          const s = deleting;
          if (!s) return;
          void run(() => assetStatusesApi.delete(s.id), `Status “${s.name}” deleted.`).then(() => setDeleting(null));
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
