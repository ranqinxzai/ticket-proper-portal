"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { approvalsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { TICKET_HELP } from "@/lib/itsm/help/ticket";
import { cn } from "@/lib/utils";
import type {
  ApprovalRequest,
  SendOptionPerson,
  SendOptionPolicy,
  SendOptionStage,
  SendOptions,
  UserRef,
} from "@/lib/itsm/types";
import { UserSearchCombobox } from "@/components/settings/user-search-combobox";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** How many people an On-fly stage needs picked: its min approvals for "any one"
 *  stages, at least one otherwise (backend `engine._picks_problem`). */
function needed(stage: SendOptionStage): number {
  return stage.rule === "any" ? Math.max(1, stage.min_approvals || 1) : 1;
}

function toUserRef(p: SendOptionPerson): UserRef {
  return { id: String(p.id), username: p.username ?? p.name, full_name: p.name, email: p.email };
}

/** Who a fixed stage resolves to for this ticket: "Priya Raman and 2 more". */
function fixedApprovers(stage: SendOptionStage): string {
  const names = stage.approver_names ?? [];
  if (names.length === 0) return stage.approver_label;
  const more = stage.approver_count - names.length;
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
}

/** "Send for approval" drawer on the agent ticket header (2026-10-24). The agent picks
 *  one of the project's active approval workflows, picks the approvers of its On-fly
 *  stages, adds an optional message, and sends. The server moves the ticket to the
 *  status's waiting status (if one is set) and freezes transitions until it's decided.
 *  Mounted only while open (module-top-level, so typing never loses focus). */
export function SendForApprovalSheet({
  ticketId,
  ticketLabel,
  onClose,
  onSent,
}: {
  ticketId: string;
  /** e.g. "INC84" — shown in the description. */
  ticketLabel: string;
  onClose: () => void;
  onSent: (req: ApprovalRequest) => void;
}) {
  const [options, setOptions] = useState<SendOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string>("");
  const [picks, setPicks] = useState<Record<string, SendOptionPerson[]>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    approvalsApi
      .sendOptions(ticketId)
      .then((o) => {
        if (!alive) return;
        setOptions(o);
        // Preselect the first policy that can start for this ticket.
        const first = o.workflows.find((w) => !w.problem) ?? o.workflows[0];
        if (first) setWorkflowId(first.id);
      })
      .catch((e) => alive && setLoadError(e instanceof ItsmApiError ? e.message : "Could not load the approval options."));
    return () => {
      alive = false;
    };
  }, [ticketId]);

  const policy: SendOptionPolicy | undefined = options?.workflows.find((w) => w.id === workflowId);

  const blockedReason = useMemo(() => {
    if (busy) return "Sending…";
    if (!options) return "Loading…";
    if (!options.allowed) return options.reason ?? "This ticket can't be sent for approval now.";
    if (options.workflows.length === 0) return TICKET_HELP.sendNoPolicies;
    if (!policy) return "Pick an approval workflow first";
    if (policy.problem) return policy.problem;
    for (const st of policy.stages) {
      if (st.approver_type !== "on_the_fly") continue;
      const need = needed(st);
      if ((picks[st.id]?.length ?? 0) < need)
        return `Pick at least ${need} approver${need > 1 ? "s" : ""} for “${st.name}”`;
    }
    return "";
  }, [busy, options, policy, picks]);

  function addPick(stageId: string, person: SendOptionPerson) {
    setPicks((cur) => {
      const list = cur[stageId] ?? [];
      if (list.some((p) => String(p.id) === String(person.id))) return cur;
      return { ...cur, [stageId]: [...list, person] };
    });
  }

  function removePick(stageId: string, id: SendOptionPerson["id"]) {
    setPicks((cur) => ({ ...cur, [stageId]: (cur[stageId] ?? []).filter((p) => String(p.id) !== String(id)) }));
  }

  async function send() {
    if (blockedReason || !policy) return;
    setBusy(true);
    setSendError(null);
    try {
      const approvers: Record<string, (number | string)[]> = {};
      for (const st of policy.stages) {
        if (st.approver_type === "on_the_fly") approvers[st.id] = (picks[st.id] ?? []).map((p) => p.id);
      }
      const req = await approvalsApi.send({ ticket: ticketId, workflow: policy.id, approvers, note: note.trim() });
      toast.success(`Sent for approval (${policy.name}).`);
      onSent(req);
    } catch (e) {
      setSendError(e instanceof ItsmApiError ? e.message : "Could not send the ticket for approval.");
    } finally {
      setBusy(false);
    }
  }

  const fromName = options?.status?.name ?? "this status";
  const waitName = options?.waiting_status?.name;

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader>
          <SheetTitle>Send for approval</SheetTitle>
          <SheetDescription>
            {ticketLabel}.{" "}
            {waitName
              ? `While it's pending the ticket moves to “${waitName}”, then comes back to “${fromName}” when it's approved, rejected or withdrawn.`
              : `The ticket stays in “${fromName}”. Status changes are locked until the approval is decided.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !options ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading approval workflows…
            </p>
          ) : !options.allowed ? (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{options.reason}</p>
          ) : options.workflows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {TICKET_HELP.sendNoPolicies}
            </p>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                  Approval workflow
                  <InfoTip label="About approval workflows">{TICKET_HELP.sendPolicy}</InfoTip>
                </legend>
                {options.workflows.map((w) => (
                  <label
                    key={w.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                      w.id === workflowId && "border-primary/50 bg-primary/5",
                      w.problem && "cursor-not-allowed opacity-80",
                    )}
                  >
                    <input
                      type="radio"
                      name="approval-workflow"
                      value={w.id}
                      checked={w.id === workflowId}
                      disabled={!!w.problem || busy}
                      onChange={() => setWorkflowId(w.id)}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{w.name}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {w.stages.length} {w.stages.length === 1 ? "stage" : "stages"}
                        {w.mode === "parallel" && w.stages.length > 1 ? " · all at once" : ""}
                      </span>
                      {w.description ? <span className="block text-xs text-muted-foreground">{w.description}</span> : null}
                      {w.problem ? (
                        <span className="mt-1 flex items-start gap-1 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          {w.problem}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>

              {policy && !policy.problem ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Approvers</h3>
                  <ol className="space-y-3">
                    {policy.stages.map((st) => (
                      <StageRow
                        key={st.id}
                        stage={st}
                        picked={picks[st.id] ?? []}
                        disabled={busy}
                        onAdd={(p) => addPick(st.id, p)}
                        onRemove={(id) => removePick(st.id, id)}
                      />
                    ))}
                  </ol>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="approval-note" className="flex items-center gap-1 text-sm font-medium">
                  Message to the approver <span className="font-normal text-muted-foreground">(optional)</span>
                  <InfoTip label="Who sees the message?">{TICKET_HELP.sendNote}</InfoTip>
                </label>
                <textarea
                  id="approval-note"
                  spellCheck
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  disabled={busy}
                  placeholder="e.g. Water damage — the laptop needs replacing, not repair."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </>
          )}
          {sendError ? (
            <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {sendError}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Hint label={blockedReason}>
            <Button size="sm" className="gap-1" onClick={() => void send()} disabled={!!blockedReason}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Send for approval
            </Button>
          </Hint>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One stage: a fixed stage shows who it resolves to; an On-fly stage gets a people
 *  picker limited to its pool, with the picks as removable chips. */
function StageRow({
  stage,
  picked,
  disabled,
  onAdd,
  onRemove,
}: {
  stage: SendOptionStage;
  picked: SendOptionPerson[];
  disabled: boolean;
  onAdd: (p: SendOptionPerson) => void;
  onRemove: (id: SendOptionPerson["id"]) => void;
}) {
  const onFly = stage.approver_type === "on_the_fly";
  const candidates = stage.candidates;
  // A group / listed pool is searched locally; "any user" searches the directory.
  const search = useMemo(() => {
    if (!onFly || candidates == null) return undefined;
    return async (q: string) => {
      const term = q.trim().toLowerCase();
      return candidates
        .filter((c) => !term || [c.name, c.username ?? "", c.email].some((v) => v.toLowerCase().includes(term)))
        .slice(0, 25)
        .map(toUserRef);
    };
  }, [onFly, candidates]);
  const need = needed(stage);

  return (
    <li className="space-y-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary-ink">
          {stage.level}
        </span>
        <span className="font-medium">{stage.name}</span>
        {onFly ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            · pick from: {stage.pool_label}
            <InfoTip label="About picking approvers">{TICKET_HELP.sendOnFly(need)}</InfoTip>
          </span>
        ) : null}
      </div>
      {onFly ? (
        <div className="space-y-1.5 pl-7">
          <UserSearchCombobox
            value={null}
            placeholder={picked.length ? "Add another approver…" : "Pick an approver…"}
            disabled={disabled}
            search={search}
            onSelect={(u) => onAdd({ id: u.id, name: u.full_name || u.username, username: u.username, email: u.email ?? "" })}
          />
          {picked.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {picked.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {p.name}
                  <IconButton
                    label={`Remove ${p.name}`}
                    disabled={disabled}
                    className="h-4 w-4 p-0 hover:bg-transparent hover:text-destructive"
                    onClick={() => onRemove(p.id)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </IconButton>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="pl-7 text-xs text-muted-foreground">Approver: {fixedApprovers(stage)}</p>
      )}
    </li>
  );
}
