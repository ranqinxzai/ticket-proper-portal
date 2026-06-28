"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, ShieldCheck, SlidersHorizontal, Trash2, XCircle } from "lucide-react";

import { workflowsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type {
  Project,
  TransitionNoteVisibility,
  WorkflowGraph,
  WorkflowStatusCategory,
  WorkflowTransition,
  WorkflowValidation,
} from "@/lib/itsm/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

export function WorkflowEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const workflowId = project.default_workflow ?? null;
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [categories, setCategories] = useState<WorkflowStatusCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowValidation | null>(null);

  // status form
  const [statusName, setStatusName] = useState("");
  const [statusCat, setStatusCat] = useState("");
  // transition form
  const [transName, setTransName] = useState("");
  const [fromStatus, setFromStatus] = useState("__create__");
  const [toStatus, setToStatus] = useState("");
  // transition whose note-prompt config dialog is open
  const [configTransition, setConfigTransition] = useState<WorkflowTransition | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [g, cats] = await Promise.all([workflowsApi.graph(workflowId), workflowsApi.categories()]);
      setGraph(g);
      setCategories(cats);
      if (cats[0]) setStatusCat((c) => c || cats[0].id);
    } catch {
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!workflowId || !statusName.trim() || !statusCat) return;
    setBusy("status");
    try {
      await workflowsApi.createStatus({
        workflow: workflowId,
        name: statusName.trim(),
        key: slugify(statusName),
        category: statusCat,
        color: "#64748b",
        sort_order: graph?.statuses.length ?? 0,
      });
      setStatusName("");
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the status.");
    } finally {
      setBusy(null);
    }
  }

  async function removeStatus(id: string) {
    setBusy(id);
    try {
      await workflowsApi.deleteStatus(id);
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the status.");
    } finally {
      setBusy(null);
    }
  }

  async function addTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!workflowId || !transName.trim() || !toStatus) return;
    setBusy("transition");
    try {
      await workflowsApi.createTransition({
        workflow: workflowId,
        name: transName.trim(),
        from_status: fromStatus === "__create__" ? null : fromStatus,
        to_status: toStatus,
        sort_order: graph?.transitions.length ?? 0,
      });
      setTransName("");
      setToStatus("");
      setFromStatus("__create__");
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the transition.");
    } finally {
      setBusy(null);
    }
  }

  async function removeTransition(id: string) {
    setBusy(id);
    try {
      await workflowsApi.deleteTransition(id);
      await load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the transition.");
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    if (!workflowId) return;
    setBusy("validate");
    try {
      setResult(await workflowsApi.validate(workflowId));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not validate.");
    } finally {
      setBusy(null);
    }
  }

  if (!workflowId) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflow assigned. Set a <span className="font-medium">Default workflow</span> in the Overview
        tab to configure its statuses and transitions.
      </p>
    );
  }
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workflow…
      </p>
    );
  }
  if (!graph) {
    return <p className="text-sm text-muted-foreground">Could not load the workflow.</p>;
  }

  const statusName_ = (id: string | null) =>
    id ? graph.statuses.find((s) => s.id === id)?.name ?? "—" : "(create)";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Workflow: <span className="font-medium text-foreground">{graph.name}</span>
        </p>
        <Button variant="outline" size="sm" className="gap-1" onClick={validate} disabled={busy === "validate"}>
          {busy === "validate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Validate
        </Button>
      </div>

      {result ? (
        <div
          className={
            "space-y-1 rounded-lg border px-4 py-3 text-sm " +
            (result.valid
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-destructive/40 bg-destructive/10 text-destructive")
          }
        >
          <p className="flex items-center gap-2 font-medium">
            {result.valid ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {result.valid ? "Workflow is valid." : "Workflow has problems:"}
          </p>
          {result.errors?.map((e, i) => <p key={`e${i}`} className="pl-6">• {e}</p>)}
          {result.warnings?.map((w, i) => (
            <p key={`w${i}`} className="pl-6 text-amber-700 dark:text-amber-300">⚠ {w}</p>
          ))}
        </div>
      ) : null}

      {/* Statuses */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Statuses</h3>
        <ul className="divide-y rounded-lg border">
          {graph.statuses
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span aria-hidden="true" className="h-3 w-3 rounded" style={{ backgroundColor: s.color }} />
                <span className="font-medium">{s.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {s.category_name}
                </span>
                {s.is_initial ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">initial</span>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    aria-label="Delete status"
                    disabled={busy === s.id}
                    onClick={() => void removeStatus(s.id)}
                    className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
        </ul>
        {canEdit ? (
          <form onSubmit={addStatus} className="flex flex-wrap items-end gap-2">
            <Input
              value={statusName}
              onChange={(e) => setStatusName(e.target.value)}
              placeholder="New status name"
              className="w-52"
            />
            <Select value={statusCat} onValueChange={setStatusCat}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" className="gap-1" disabled={busy === "status" || !statusName.trim()}>
              {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add status
            </Button>
          </form>
        ) : null}
      </section>

      {/* Transitions */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Transitions</h3>
        <ul className="divide-y rounded-lg border">
          {graph.transitions
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {statusName_(t.from_status)} → {statusName_(t.to_status)}
                </span>
                {t.is_global ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">global</span>
                ) : null}
                {t.note_prompt ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                    note: {t.note_heading || "—"}{t.note_required ? " *" : ""}
                  </span>
                ) : null}
                {t.portal_allowed ? (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                    portal
                  </span>
                ) : null}
                {canEdit ? (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Configure transition"
                      title="Configure transition"
                      onClick={() => setConfigTransition(t)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete transition"
                      disabled={busy === t.id}
                      onClick={() => void removeTransition(t.id)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
        </ul>
        {canEdit ? (
          <form onSubmit={addTransition} className="flex flex-wrap items-end gap-2">
            <Input
              value={transName}
              onChange={(e) => setTransName(e.target.value)}
              placeholder="Transition name"
              className="w-44"
            />
            <Select value={fromStatus} onValueChange={setFromStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="From" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__create__">(create)</SelectItem>
                {graph.statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={toStatus} onValueChange={setToStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="To" /></SelectTrigger>
              <SelectContent>
                {graph.statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" className="gap-1" disabled={busy === "transition" || !transName.trim() || !toStatus}>
              {busy === "transition" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add transition
            </Button>
          </form>
        ) : null}
      </section>

      {configTransition ? (
        <TransitionNoteDialog
          key={configTransition.id}
          transition={configTransition}
          onClose={() => setConfigTransition(null)}
          onSaved={() => {
            setConfigTransition(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/** Per-transition note-prompt config: toggle, heading, type (public/internal) and
 *  mandatory/optional. Module-top-level + remounted per transition (via `key`), so its
 *  local form state initialises straight from props (React focus-stability). */
function TransitionNoteDialog({
  transition,
  onClose,
  onSaved,
}: {
  transition: WorkflowTransition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState(!!transition.note_prompt);
  const [heading, setHeading] = useState(transition.note_heading ?? "");
  const [visibility, setVisibility] = useState<TransitionNoteVisibility>(
    transition.note_visibility ?? "public",
  );
  const [requirement, setRequirement] = useState(transition.note_required ? "required" : "optional");
  const [portalAllowed, setPortalAllowed] = useState(!!transition.portal_allowed);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await workflowsApi.updateTransition(transition.id, {
        note_prompt: prompt,
        note_required: prompt && requirement === "required",
        note_heading: prompt ? heading.trim() : "",
        note_visibility: visibility,
        portal_allowed: portalAllowed,
      });
      onSaved();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not save the note settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transition settings — {transition.name}</DialogTitle>
          <DialogDescription>
            Ask the agent for a note when this transition runs (e.g. a “Reason to hold”). The note
            is posted as a comment on the ticket. You can also let end-users run this transition
            from the Service Portal (e.g. Reopen).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={portalAllowed}
              onChange={(e) => setPortalAllowed(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Allowed from portal <span className="font-normal text-muted-foreground">— lets requestors run this (e.g. Reopen)</span>
          </label>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={prompt}
              onChange={(e) => setPrompt(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Prompt for a note on this transition
          </label>

          {prompt ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Note heading</label>
                <Input
                  value={heading}
                  onChange={(e) => setHeading(e.target.value)}
                  placeholder="e.g. Reason to hold"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Note type</label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as TransitionNoteVisibility)}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public Comment</SelectItem>
                      <SelectItem value="private">Internal Note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Requirement</label>
                  <Select value={requirement} onValueChange={setRequirement}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="optional">Optional</SelectItem>
                      <SelectItem value="required">Mandatory</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" className="gap-1" onClick={save} disabled={saving || (prompt && !heading.trim())}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
