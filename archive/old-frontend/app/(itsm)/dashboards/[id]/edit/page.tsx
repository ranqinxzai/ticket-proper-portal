"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Gauge,
  LayoutDashboard,
  List,
  Loader2,
  PieChart as PieIcon,
  Plus,
  Settings2,
  Sigma,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dashAdminApi } from "@/lib/itsm/admin-api";
import { savedFiltersApi } from "@/lib/itsm/api";
import type { Dashboard, Widget, WidgetType } from "@/lib/itsm/admin-types";
import type { SavedFilter } from "@/lib/itsm/types";
import { ItsmApiError } from "@/lib/itsm/client";
import { WidgetRenderer } from "@/components/itsm/WidgetRenderer";

type WidgetSize = "sm" | "md" | "lg";

const SIZE_COL_SPAN: Record<WidgetSize, string> = {
  sm: "lg:col-span-1",
  md: "lg:col-span-2 sm:col-span-2",
  lg: "lg:col-span-4 sm:col-span-2",
};

const PALETTE_TYPES: { type: WidgetType; label: string; icon: typeof PieIcon }[] = [
  { type: "kpi", label: "KPI", icon: Sigma },
  { type: "pie", label: "Pie", icon: PieIcon },
  { type: "bar", label: "Bar", icon: LayoutDashboard },
  { type: "trend", label: "Trend", icon: TrendingUp },
  { type: "sla", label: "SLA", icon: Gauge },
  { type: "ticket_list", label: "Ticket list", icon: List },
];

const DEFAULT_TITLE: Record<WidgetType, string> = {
  kpi: "KPI",
  pie: "Breakdown",
  bar: "Breakdown",
  trend: "Created vs Resolved",
  sla: "SLA compliance",
  ticket_list: "Tickets",
};

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ItsmApiError ? e.message : fallback;
}

function getSize(w: Widget): WidgetSize {
  const s = (w.config?.size as string | undefined) ?? "sm";
  return s === "md" || s === "lg" ? s : "sm";
}

export default function DashboardBuilderPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  /** Bumped per-widget to force the renderer to re-fetch after a config change. */
  const [refreshTick, setRefreshTick] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([dashAdminApi.get(id), savedFiltersApi.list().catch(() => [])])
      .then(([d, f]) => {
        if (cancelled) return;
        setDashboard(d);
        setNameDraft(d.name);
        setFilters(f);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errMsg(e, "Failed to load dashboard"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const widgets = useMemo(
    () => (dashboard ? [...dashboard.widgets].sort((a, b) => a.sort_order - b.sort_order) : []),
    [dashboard],
  );

  const bumpWidget = useCallback((wid: string) => {
    setRefreshTick((t) => ({ ...t, [wid]: (t[wid] ?? 0) + 1 }));
  }, []);

  // ---- dashboard-level mutations ------------------------------------------

  async function saveName() {
    if (!dashboard) return;
    const next = nameDraft.trim() || "Untitled dashboard";
    if (next === dashboard.name) return;
    try {
      const updated = await dashAdminApi.update(dashboard.id, { name: next });
      setDashboard((d) => (d ? { ...d, name: updated.name } : d));
      toast.success("Renamed");
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to rename"));
      setNameDraft(dashboard.name);
    }
  }

  async function toggleShared(value: boolean) {
    if (!dashboard) return;
    try {
      await dashAdminApi.update(dashboard.id, { is_shared: value });
      setDashboard((d) => (d ? { ...d, is_shared: value } : d));
      toast.success(value ? "Shared with team" : "Made private");
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to update sharing"));
    }
  }

  // ---- widget mutations ----------------------------------------------------

  async function addWidget(type: WidgetType) {
    if (!dashboard) return;
    const sortOrder = widgets.length ? Math.max(...widgets.map((w) => w.sort_order)) + 1 : 0;
    try {
      const w = await dashAdminApi.createWidget({
        dashboard: dashboard.id,
        widget_type: type,
        title: DEFAULT_TITLE[type],
        config: { size: "sm" },
        sort_order: sortOrder,
      });
      setDashboard((d) => (d ? { ...d, widgets: [...d.widgets, w] } : d));
      toast.success(`Added ${DEFAULT_TITLE[type]}`);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to add widget"));
    }
  }

  async function patchWidget(wid: string, body: Partial<Widget>, opts: { refetch?: boolean } = {}) {
    try {
      const updated = await dashAdminApi.updateWidget(wid, body);
      setDashboard((d) =>
        d ? { ...d, widgets: d.widgets.map((w) => (w.id === wid ? { ...w, ...updated } : w)) } : d,
      );
      if (opts.refetch) bumpWidget(wid);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to update widget"));
    }
  }

  async function removeWidget(wid: string) {
    try {
      await dashAdminApi.deleteWidget(wid);
      setDashboard((d) => (d ? { ...d, widgets: d.widgets.filter((w) => w.id !== wid) } : d));
      toast.success("Widget removed");
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to remove widget"));
    }
  }

  async function move(wid: string, dir: -1 | 1) {
    const idx = widgets.findIndex((w) => w.id === wid);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= widgets.length) return;
    const a = widgets[idx];
    const b = widgets[swapIdx];
    // optimistic swap of sort_order
    setDashboard((d) =>
      d
        ? {
            ...d,
            widgets: d.widgets.map((w) =>
              w.id === a.id ? { ...w, sort_order: b.sort_order } : w.id === b.id ? { ...w, sort_order: a.sort_order } : w,
            ),
          }
        : d,
    );
    try {
      await Promise.all([
        dashAdminApi.updateWidget(a.id, { sort_order: b.sort_order }),
        dashAdminApi.updateWidget(b.id, { sort_order: a.sort_order }),
      ]);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to reorder"));
    }
  }

  // ---- render --------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="space-y-4">
        <Link href="/dashboards" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to dashboards
        </Link>
        <div className="rounded-lg border border-dashed bg-white p-10 text-center text-sm text-destructive">
          {error ?? "Dashboard not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboards" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to dashboards
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5 text-indigo-500" />
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="h-9 w-64 text-base font-semibold"
            aria-label="Dashboard name"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={dashboard.is_shared} onCheckedChange={toggleShared} />
          <span className="text-muted-foreground">Shared</span>
        </label>
      </div>

      {/* widget palette */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <span className="mr-1 text-sm text-muted-foreground">Add widget:</span>
        {PALETTE_TYPES.map(({ type, label, icon: Icon }) => (
          <Button key={type} variant="outline" size="sm" onClick={() => addWidget(type)}>
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* widget grid */}
      {widgets.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-10 text-center">
          <Plus className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">Add a widget from the palette above to get started.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {widgets.map((w, i) => (
            <WidgetCard
              key={w.id}
              widget={w}
              filters={filters}
              refreshKey={refreshTick[w.id] ?? 0}
              isFirst={i === 0}
              isLast={i === widgets.length - 1}
              onRename={(title) => patchWidget(w.id, { title })}
              onConfig={(config) => patchWidget(w.id, { config }, { refetch: true })}
              onFilter={(saved_filter) => patchWidget(w.id, { saved_filter }, { refetch: true })}
              onResize={(size) => patchWidget(w.id, { config: { ...w.config, size } })}
              onMove={(dir) => move(w.id, dir)}
              onRemove={() => removeWidget(w.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- widget card ----------------------------------------------------------

function WidgetCard({
  widget,
  filters,
  refreshKey,
  isFirst,
  isLast,
  onRename,
  onConfig,
  onFilter,
  onResize,
  onMove,
  onRemove,
}: {
  widget: Widget;
  filters: SavedFilter[];
  refreshKey: number;
  isFirst: boolean;
  isLast: boolean;
  onRename: (title: string) => void;
  onConfig: (config: Record<string, unknown>) => void;
  onFilter: (savedFilter: string | null) => void;
  onResize: (size: WidgetSize) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const size = getSize(widget);
  const [titleDraft, setTitleDraft] = useState(widget.title);

  useEffect(() => {
    setTitleDraft(widget.title);
  }, [widget.title]);

  return (
    <div className={`flex flex-col rounded-lg border bg-white ${SIZE_COL_SPAN[size]}`}>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <Input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            const next = titleDraft.trim();
            if (next && next !== widget.title) onRename(next);
            else setTitleDraft(widget.title);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-7 flex-1 border-transparent px-1 text-sm font-medium shadow-none focus-visible:border-input"
          aria-label="Widget title"
        />
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isFirst} onClick={() => onMove(-1)} title="Move up">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isLast} onClick={() => onMove(1)} title="Move down">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Configure">
              <Settings2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <WidgetConfig widget={widget} filters={filters} onConfig={onConfig} onFilter={onFilter} onResize={onResize} />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          title="Remove"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 p-3">
        <WidgetRenderer widget={widget} refreshKey={refreshKey} />
      </div>
    </div>
  );
}

// ---- config popover -------------------------------------------------------

function WidgetConfig({
  widget,
  filters,
  onConfig,
  onFilter,
  onResize,
}: {
  widget: Widget;
  filters: SavedFilter[];
  onConfig: (config: Record<string, unknown>) => void;
  onFilter: (savedFilter: string | null) => void;
  onResize: (size: WidgetSize) => void;
}) {
  const cfg = widget.config ?? {};
  const size = getSize(widget);

  function setCfg(key: string, value: unknown) {
    onConfig({ ...cfg, [key]: value });
  }

  return (
    <div className="space-y-3 text-sm">
      {/* type-specific knobs */}
      {widget.widget_type === "kpi" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Metric</Label>
          <Select value={(cfg.metric as string) ?? "open_count"} onValueChange={(v) => setCfg("metric", v)}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open_count">Open count</SelectItem>
              <SelectItem value="breached_count">Breached count</SelectItem>
              <SelectItem value="sla_compliance">SLA compliance %</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {(widget.widget_type === "pie" || widget.widget_type === "bar") && (
        <div className="space-y-1.5">
          <Label className="text-xs">Group by</Label>
          <Select value={(cfg.group_by as string) ?? "status"} onValueChange={(v) => setCfg("group_by", v)}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="group">Group</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {widget.widget_type === "trend" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Days</Label>
          <Input
            type="number"
            min={1}
            className="h-8"
            value={String(cfg.days ?? 30)}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n > 0) setCfg("days", n);
            }}
          />
        </div>
      )}

      {widget.widget_type === "ticket_list" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Limit</Label>
          <Input
            type="number"
            min={1}
            className="h-8"
            value={String(cfg.limit ?? 10)}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n > 0) setCfg("limit", n);
            }}
          />
        </div>
      )}

      {/* saved filter (scopes the data) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Saved filter</Label>
        <Select
          value={widget.saved_filter ?? "__none__"}
          onValueChange={(v) => onFilter(v === "__none__" ? null : v)}
        >
          <SelectTrigger className="h-8">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None (all tickets)</SelectItem>
            {filters.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* size */}
      <div className="space-y-1.5">
        <Label className="text-xs">Size</Label>
        <Select value={size} onValueChange={(v) => onResize(v as WidgetSize)}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sm">Small (1 column)</SelectItem>
            <SelectItem value="md">Medium (2 columns)</SelectItem>
            <SelectItem value="lg">Large (full width)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
