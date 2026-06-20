"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Spline,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { workflowsApi } from "@/lib/itsm/admin-api";
import type {
  GraphValidation,
  StatusCategoryRow,
  WfStatus,
  WfTransition,
  WorkflowGraph,
} from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import { WorkflowCanvas, type CanvasSelection } from "@/components/itsm/WorkflowCanvas";

const POST_FUNCTION_TYPES = [
  "auto_assign",
  "set_assignee",
  "clear_assignee",
  "set_priority",
  "set_resolution",
  "clear_resolution",
  "stamp_timestamp",
  "start_sla",
  "stop_sla",
  "pause_sla",
  "resume_sla",
  "emit_event",
] as const;

const PRESET_COLORS = ["#64748b", "#0ea5e9", "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ItsmApiError) return e.message || fallback;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function WorkflowBuilderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.workflows", "read");
  const canWrite = isSupervisor || hasPerm("itsm.workflows", "update");

  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [categories, setCategories] = useState<StatusCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [validation, setValidation] = useState<GraphValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Add-transition wiring state.
  const [addMode, setAddMode] = useState(false);
  const [pendingSource, setPendingSource] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, cats] = await Promise.all([workflowsApi.graph(id), workflowsApi.categories()]);
      setGraph(g);
      setCategories(cats);
    } catch (e) {
      setError(errMsg(e, "Failed to load workflow"));
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  // Refetch the graph after a mutation, then flag "Saved".
  const refresh = useCallback(async () => {
    try {
      const g = await workflowsApi.graph(id);
      setGraph(g);
      setSavedAt(Date.now());
    } catch (e) {
      toast.error(errMsg(e, "Failed to refresh workflow"));
    }
  }, [id]);

  const selectedStatus = useMemo<WfStatus | null>(() => {
    if (!graph || selection?.kind !== "status") return null;
    return graph.statuses.find((s) => s.id === selection.id) ?? null;
  }, [graph, selection]);

  const selectedTransition = useMemo<WfTransition | null>(() => {
    if (!graph || selection?.kind !== "transition") return null;
    return graph.transitions.find((t) => t.id === selection.id) ?? null;
  }, [graph, selection]);

  // --- node drag persistence (optimistic local + PATCH) ---------------------
  const handleNodeMoved = useCallback(
    async (statusId: string, x: number, y: number) => {
      if (!canWrite) {
        toast.error("You don't have permission to edit this workflow.");
        return;
      }
      setGraph((g) =>
        g
          ? { ...g, statuses: g.statuses.map((s) => (s.id === statusId ? { ...s, canvas_x: x, canvas_y: y } : s)) }
          : g,
      );
      try {
        await workflowsApi.updateStatus(statusId, { canvas_x: x, canvas_y: y });
        setSavedAt(Date.now());
      } catch (e) {
        toast.error(errMsg(e, "Failed to save position"));
        refresh();
      }
    },
    [canWrite, refresh],
  );

  // --- add status -----------------------------------------------------------
  const handleAddStatus = useCallback(async () => {
    if (!graph) return;
    const todo = categories.find((c) => c.key === "todo") ?? categories[0];
    if (!todo) {
      toast.error("No status categories available.");
      return;
    }
    const n = graph.statuses.length + 1;
    try {
      const created = await workflowsApi.createStatus({
        workflow: graph.id,
        name: `New status ${n}`,
        key: `new_status_${n}`,
        category: todo.id,
        color: todo.color || "#64748b",
        is_initial: graph.statuses.length === 0,
        canvas_x: 60 + (graph.statuses.length % 5) * 200,
        canvas_y: 60 + Math.floor(graph.statuses.length / 5) * 120,
        sort_order: graph.statuses.length,
      });
      toast.success("Status added");
      await refresh();
      setSelection({ kind: "status", id: created.id });
    } catch (e) {
      toast.error(errMsg(e, "Failed to add status"));
    }
  }, [graph, categories, refresh]);

  // --- add transition wiring ------------------------------------------------
  const startAddTransition = useCallback(() => {
    setAddMode(true);
    setPendingSource(null);
    setSelection(null);
    toast.info("Pick a source status, then a target status.");
  }, []);

  const cancelAddTransition = useCallback(() => {
    setAddMode(false);
    setPendingSource(null);
  }, []);

  const handleNodeClickInAddMode = useCallback(
    async (statusId: string) => {
      if (!graph) return;
      if (!pendingSource) {
        setPendingSource(statusId);
        return;
      }
      if (pendingSource === statusId) {
        toast.error("Source and target must differ.");
        return;
      }
      const source = pendingSource;
      try {
        const created = await workflowsApi.createTransition({
          workflow: graph.id,
          name: "New transition",
          from_status: source,
          to_status: statusId,
        });
        toast.success("Transition created");
        setAddMode(false);
        setPendingSource(null);
        await refresh();
        setSelection({ kind: "transition", id: created.id });
      } catch (e) {
        toast.error(errMsg(e, "Failed to create transition"));
        setPendingSource(null);
      }
    },
    [graph, pendingSource, refresh],
  );

  // --- validate -------------------------------------------------------------
  const handleValidate = useCallback(async () => {
    setValidating(true);
    try {
      const res = await workflowsApi.validate(id);
      setValidation(res);
      if (res.valid && res.warnings.length === 0) {
        toast.success("Workflow is valid.");
      } else if (res.valid) {
        toast.warning(`Valid with ${res.warnings.length} warning(s).`);
      } else {
        toast.error(`${res.errors.length} error(s) found.`);
      }
    } catch (e) {
      toast.error(errMsg(e, "Validation failed"));
    } finally {
      setValidating(false);
    }
  }, [id]);

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading workflow…
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div className="space-y-3">
        <Link href="/admin/workflows" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to workflows
        </Link>
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-destructive">
          {error ?? "Workflow not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header / toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/workflows" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold">{graph.name}</h1>
        <Badge variant="outline" className="capitalize">
          {graph.base_type}
        </Badge>
        {!canWrite && (
          <Badge variant="outline" className="gap-1 text-amber-600">
            <ShieldCheck className="h-3 w-3" /> Read only
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {savedAt && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {canWrite && !addMode && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAddStatus}>
                <Plus className="h-4 w-4" /> Status
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={startAddTransition}>
                <Spline className="h-4 w-4" /> Transition
              </Button>
            </>
          )}
          {addMode && (
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={cancelAddTransition}>
              <X className="h-4 w-4" /> Cancel wiring
            </Button>
          )}
          <Button size="sm" className="gap-1.5" onClick={handleValidate} disabled={validating}>
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Validate
          </Button>
        </div>
      </div>

      {addMode && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
          {pendingSource ? "Now click the target status." : "Click the source status to start a transition."}
        </div>
      )}

      {/* Validation results */}
      {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-1.5 rounded-lg border bg-white p-3 text-sm">
          {validation.errors.map((msg, i) => (
            <div key={`err-${i}`} className="flex items-start gap-2 text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> <span>{msg}</span>
            </div>
          ))}
          {validation.warnings.map((msg, i) => (
            <div key={`warn-${i}`} className="flex items-start gap-2 text-amber-600">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> <span>{msg}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <WorkflowCanvas
          statuses={graph.statuses}
          transitions={graph.transitions}
          selection={selection}
          addTransitionMode={addMode}
          pendingSource={pendingSource}
          onSelect={setSelection}
          onNodeMoved={handleNodeMoved}
          onNodeClickInAddMode={handleNodeClickInAddMode}
        />

        <Inspector
          status={selectedStatus}
          transition={selectedTransition}
          categories={categories}
          statuses={graph.statuses}
          canWrite={canWrite}
          onAfterChange={refresh}
          onClearSelection={() => setSelection(null)}
        />
      </div>
    </div>
  );
}

// ===========================================================================
// Inspector
// ===========================================================================

function Inspector({
  status,
  transition,
  categories,
  statuses,
  canWrite,
  onAfterChange,
  onClearSelection,
}: {
  status: WfStatus | null;
  transition: WfTransition | null;
  categories: StatusCategoryRow[];
  statuses: WfStatus[];
  canWrite: boolean;
  onAfterChange: () => Promise<void>;
  onClearSelection: () => void;
}) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="mb-2 text-sm font-semibold">Inspector</div>
      {status ? (
        <StatusInspector
          key={status.id}
          status={status}
          categories={categories}
          canWrite={canWrite}
          onAfterChange={onAfterChange}
          onClearSelection={onClearSelection}
        />
      ) : transition ? (
        <TransitionInspector
          key={transition.id}
          transition={transition}
          statuses={statuses}
          canWrite={canWrite}
          onAfterChange={onAfterChange}
          onClearSelection={onClearSelection}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Select a status node or a transition to edit it.</p>
      )}
    </div>
  );
}

// --- Status inspector ------------------------------------------------------

function StatusInspector({
  status,
  categories,
  canWrite,
  onAfterChange,
  onClearSelection,
}: {
  status: WfStatus;
  categories: StatusCategoryRow[];
  canWrite: boolean;
  onAfterChange: () => Promise<void>;
  onClearSelection: () => void;
}) {
  const [name, setName] = useState(status.name);
  const [category, setCategory] = useState(status.category);
  const [color, setColor] = useState(status.color || "#64748b");
  const [isInitial, setIsInitial] = useState(status.is_initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await workflowsApi.updateStatus(status.id, {
        name: name.trim(),
        category,
        color,
        is_initial: isInitial,
      });
      toast.success("Status updated");
      await onAfterChange();
    } catch (e) {
      toast.error(errMsg(e, "Failed to update status"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete status "${status.name}"? Transitions referencing it may be affected.`)) return;
    setBusy(true);
    try {
      await workflowsApi.deleteStatus(status.id);
      toast.success("Status deleted");
      onClearSelection();
      await onAfterChange();
    } catch (e) {
      toast.error(errMsg(e, "Failed to delete status"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-indigo-500">
        Status
        <span className="ml-auto font-mono text-[10px] normal-case text-slate-400">{status.key}</span>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="st-name">Name</Label>
        <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="st-cat">Category</Label>
        <Select value={category} onValueChange={setCategory} disabled={!canWrite}>
          <SelectTrigger id="st-cat" className="h-9">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="st-color">Color</Label>
        <div className="flex items-center gap-2">
          <input
            id="st-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={!canWrite}
            className="h-9 w-10 cursor-pointer rounded border bg-white p-0.5 disabled:cursor-not-allowed"
          />
          <Input value={color} onChange={(e) => setColor(e.target.value)} disabled={!canWrite} className="h-9 font-mono text-xs" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!canWrite}
              onClick={() => setColor(c)}
              className="h-5 w-5 rounded-full border border-black/10 ring-offset-1 transition hover:ring-2 hover:ring-indigo-400 disabled:cursor-not-allowed"
              style={{ backgroundColor: c }}
              aria-label={`Use ${c}`}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between text-sm">
        <span>Initial status</span>
        <Switch checked={isInitial} onCheckedChange={setIsInitial} disabled={!canWrite} />
      </label>

      <Separator />

      <div className="flex items-center gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={save} disabled={busy || !canWrite}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={remove}
          disabled={busy || !canWrite}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// --- Transition inspector --------------------------------------------------

type DraftPostFn = { type: string; configText: string };

function TransitionInspector({
  transition,
  statuses,
  canWrite,
  onAfterChange,
  onClearSelection,
}: {
  transition: WfTransition;
  statuses: WfStatus[];
  canWrite: boolean;
  onAfterChange: () => Promise<void>;
  onClearSelection: () => void;
}) {
  const [name, setName] = useState(transition.name);
  const [postFns, setPostFns] = useState<DraftPostFn[]>(
    transition.post_functions.map((pf) => ({
      type: pf.type,
      configText: JSON.stringify(pf.config ?? {}, null, 2),
    })),
  );
  const [busy, setBusy] = useState(false);

  const fromName = transition.from_status
    ? statuses.find((s) => s.id === transition.from_status)?.name ?? transition.from_status_key ?? "?"
    : "(create)";
  const toName = statuses.find((s) => s.id === transition.to_status)?.name ?? transition.to_status_key ?? "?";

  function updateFn(i: number, patch: Partial<DraftPostFn>) {
    setPostFns((prev) => prev.map((pf, idx) => (idx === i ? { ...pf, ...patch } : pf)));
  }
  function addFn() {
    setPostFns((prev) => [...prev, { type: POST_FUNCTION_TYPES[0], configText: "{}" }]);
  }
  function removeFn(i: number) {
    setPostFns((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    // Parse each post-function config JSON; bail with a clear toast on bad JSON.
    const parsed: { type: string; config: Record<string, unknown> }[] = [];
    for (let i = 0; i < postFns.length; i++) {
      const pf = postFns[i];
      const text = pf.configText.trim() || "{}";
      let cfg: unknown;
      try {
        cfg = JSON.parse(text);
      } catch {
        toast.error(`Post-function #${i + 1} (${pf.type}) has invalid JSON config.`);
        return;
      }
      if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
        toast.error(`Post-function #${i + 1} (${pf.type}) config must be a JSON object.`);
        return;
      }
      parsed.push({ type: pf.type, config: cfg as Record<string, unknown> });
    }

    setBusy(true);
    try {
      await workflowsApi.updateTransition(transition.id, {
        name: name.trim(),
        post_functions: parsed,
      });
      toast.success("Transition updated");
      await onAfterChange();
    } catch (e) {
      toast.error(errMsg(e, "Failed to update transition"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete transition "${transition.name || "(unnamed)"}"?`)) return;
    setBusy(true);
    try {
      await workflowsApi.deleteTransition(transition.id);
      toast.success("Transition deleted");
      onClearSelection();
      await onAfterChange();
    } catch (e) {
      toast.error(errMsg(e, "Failed to delete transition"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-indigo-500">
        Transition
        {transition.is_global && (
          <Badge variant="outline" className="ml-auto text-[10px] text-emerald-600">
            Global
          </Badge>
        )}
      </div>

      <div className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
        <span className="font-medium">{fromName}</span>
        <span className="mx-1.5 text-slate-400">→</span>
        <span className="font-medium">{toName}</span>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="tr-name">Name</Label>
        <Input id="tr-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Label>Post-functions</Label>
        {canWrite && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={addFn}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {postFns.length === 0 ? (
        <p className="text-xs text-muted-foreground">No post-functions on this transition.</p>
      ) : (
        <div className="space-y-2">
          {postFns.map((pf, i) => (
            <div key={i} className="space-y-1.5 rounded-md border bg-slate-50/60 p-2">
              <div className="flex items-center gap-2">
                <Select value={pf.type} onValueChange={(v) => updateFn(i, { type: v })} disabled={!canWrite}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {POST_FUNCTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => removeFn(i)}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-destructive"
                    aria-label="Remove post-function"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <textarea
                value={pf.configText}
                onChange={(e) => updateFn(i, { configText: e.target.value })}
                disabled={!canWrite}
                spellCheck={false}
                rows={3}
                placeholder="{}"
                className="w-full resize-y rounded border bg-white px-2 py-1.5 font-mono text-[11px] leading-snug outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </div>
          ))}
        </div>
      )}

      <Separator />

      <div className="flex items-center gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={save} disabled={busy || !canWrite}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={remove}
          disabled={busy || !canWrite}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
