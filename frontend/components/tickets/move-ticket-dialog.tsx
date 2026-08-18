"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ticketsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { MoveOptions, TicketDetail } from "@/lib/itsm/types";
import { toast } from "sonner";

const DROP = "__drop__";

/** A source custom field's current move decision + whether its value will be lost. */
type Decision = { targetKey: string; willDrop: boolean };

function buildDecisions(options: MoveOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of options.fields) out[f.source_key] = f.proposed_target_key ?? DROP;
  return out;
}

/** Step 1 — pick the target project (same helpdesk, excluding the current one). */
function MoveStepProject({
  projects,
  value,
  onChange,
}: {
  projects: { id: string; name: string; key: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no other projects in this workspace to move this ticket to.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Choose the project to move this ticket to. It will get a new ticket number in that project.
      </p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a project…" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name} <span className="text-muted-foreground">({p.key})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** One row of the field-mapping table. */
function MoveFieldRow({
  row,
  value,
  onChange,
}: {
  row: MoveOptions["fields"][number];
  value: string;
  onChange: (v: string) => void;
}) {
  const willDrop = value === DROP;
  const hasValue = row.current_display_value.trim() !== "";
  return (
    <div className="rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.source_name}</p>
          {hasValue ? (
            <p className="truncate text-xs text-muted-foreground" title={row.current_display_value}>
              {row.current_display_value}
            </p>
          ) : null}
        </div>
        <Select value={value} onValueChange={onChange} disabled={row.will_drop_forced}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {row.candidates.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
            <SelectItem value={DROP}>Don&apos;t move (drop value)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {willDrop && hasValue ? (
        <p className="mt-1 flex items-center gap-1 rounded bg-warning/15 px-2 py-1 text-xs text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          This value will be dropped.
        </p>
      ) : null}
    </div>
  );
}

export function MoveTicketDialog({
  ticket,
  currentProjectId,
  onClose,
  onMoved,
}: {
  ticket: TicketDetail;
  currentProjectId: string;
  onClose: () => void;
  onMoved: (moved: TicketDetail) => void;
}) {
  const { projects } = useWorkspace();
  const targets = useMemo(
    () => projects.filter((p) => p.id !== currentProjectId),
    [projects, currentProjectId],
  );

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [targetProjectId, setTargetProjectId] = useState("");
  const [options, setOptions] = useState<MoveOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [typeId, setTypeId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});

  const targetProjectName = targets.find((p) => p.id === targetProjectId)?.name ?? "";

  async function loadOptions() {
    setLoadingOptions(true);
    setError(null);
    try {
      const opts = await ticketsApi.moveOptions(ticket.id, targetProjectId);
      setOptions(opts);
      setTypeId(opts.default_target_type_id || (opts.target_types[0]?.id ?? ""));
      setStatusId(opts.suggested_status_id || (opts.target_statuses[0]?.id ?? ""));
      setChoice(buildDecisions(opts));
      setStep(2);
    } catch (e) {
      setError(e instanceof ItsmApiError ? e.message : "Could not load field mapping.");
    } finally {
      setLoadingOptions(false);
    }
  }

  const dropped: Decision[] = useMemo(() => {
    if (!options) return [];
    return options.fields
      .filter((f) => (choice[f.source_key] ?? DROP) === DROP && f.current_display_value.trim() !== "")
      .map((f) => ({ targetKey: f.source_name, willDrop: true }));
  }, [options, choice]);

  // Confirm is blocked while the required mappings are incomplete. A pending
  // approval forces the target's start status (backend), so status is not required.
  const statusRequired = !(options?.has_pending_approval ?? false);
  const canConfirm = !!typeId && (!statusRequired || !!statusId);

  async function submit() {
    if (!options) return;
    setBusy(true);
    try {
      const field_mapping: Record<string, string> = {};
      const drop_field_keys: string[] = [];
      for (const f of options.fields) {
        const v = choice[f.source_key] ?? DROP;
        if (v === DROP) drop_field_keys.push(f.source_key);
        else field_mapping[f.source_key] = v;
      }
      const moved = await ticketsApi.move(ticket.id, {
        target_project: targetProjectId,
        target_ticket_type: typeId,
        target_status: statusId,
        field_mapping,
        drop_field_keys,
      });
      onMoved(moved);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not move the ticket.");
    } finally {
      setBusy(false);
    }
  }

  const targetType = options?.target_types.find((t) => t.id === typeId);
  const targetStatus = options?.target_statuses.find((s) => s.id === statusId);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move ticket {ticket.ticket_number}</DialogTitle>
          <DialogDescription>
            {step === 1 && "Step 1 of 3 — Select the destination project."}
            {step === 2 && "Step 2 of 3 — Map fields and status."}
            {step === 3 && "Step 3 of 3 — Confirm the move."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <MoveStepProject projects={targets} value={targetProjectId} onChange={setTargetProjectId} />
        ) : null}

        {step === 2 && options ? (
          <div className="space-y-4">
            {options.has_pending_approval ? (
              <p className="flex items-start gap-2 rounded-md bg-warning/15 p-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                This ticket has a pending approval. Moving it will cancel that approval and start the
                ticket in the new project&apos;s first status.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Ticket type</span>
                <Select value={typeId} onValueChange={setTypeId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {options.target_types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Status</span>
                <Select
                  value={statusId}
                  onValueChange={setStatusId}
                  disabled={options.has_pending_approval}
                >
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {options.target_statuses.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            {options.fields.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Fields</p>
                {options.fields.map((f) => (
                  <MoveFieldRow
                    key={f.source_key}
                    row={f}
                    value={choice[f.source_key] ?? DROP}
                    onChange={(v) => setChoice((c) => ({ ...c, [f.source_key]: v }))}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                All fields carry over — no values will be dropped.
              </p>
            )}
          </div>
        ) : null}

        {step === 3 && options ? (
          <div className="space-y-3 text-sm">
            <p>
              Ticket <strong>{ticket.ticket_number}</strong> will move to{" "}
              <strong>{options.target_project.name}</strong> and receive a <strong>new ticket number</strong>.
            </p>
            <ul className="space-y-1 text-muted-foreground">
              <li>Type: {ticket.ticket_type_name ?? "—"} → {targetType?.name ?? "—"}</li>
              <li>
                Status:{" "}
                {options.has_pending_approval
                  ? `${ticket.status_name} → the new project's first status (pending approval cancelled)`
                  : `${ticket.status_name} → ${targetStatus?.name ?? "—"}`}
              </li>
            </ul>
            {dropped.length > 0 ? (
              <div className="rounded-md bg-warning/15 p-2 text-warning">
                <p className="flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  These values will be dropped:
                </p>
                <ul className="ml-5 list-disc">
                  {dropped.map((d) => <li key={d.targetKey}>{d.targetKey}</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground">No field values will be dropped.</p>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2)} disabled={busy}>
              Back
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          )}
          {step === 1 ? (
            <Button onClick={loadOptions} disabled={!targetProjectId || loadingOptions}>
              {loadingOptions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Next
            </Button>
          ) : null}
          {step === 2 ? (
            <Button onClick={() => setStep(3)} disabled={!canConfirm}>Next</Button>
          ) : null}
          {step === 3 ? (
            <Button onClick={submit} disabled={busy || !canConfirm}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? "Moving…" : `Move to ${targetProjectName}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
