"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, RotateCcw, ScrollText, Search } from "lucide-react";
import { toast } from "sonner";

import { auditLogApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { AUDIT_HELP } from "@/lib/itsm/help/admin";
import { pageList } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import type { AdminAuditEvent, AuditChange, AuditFacets, AuditLogFilters } from "@/lib/itsm/types";
import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const PAGE_SIZES = [25, 50, 100] as const;
const COLS = 7;
const DEFAULT_CAP = 10000;

type Filters = { from: string; to: string; actor: string; area: string; action: string; q: string };

/** yyyy-mm-dd for a local date. */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function defaultFilters(): Filters {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: ymd(from), to: ymd(to), actor: "", area: "", action: "", q: "" };
}

/** Local calendar dates → ISO instants (start / end of the local day). */
function toParams(f: Filters): AuditLogFilters {
  return {
    date_from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
    date_to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : undefined,
    actor: f.actor || undefined,
    area: f.area || undefined,
    action: f.action || undefined,
    q: f.q.trim() || undefined,
  };
}

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

const FAIL_ACTIONS = new Set(["login_failed", "password_change_failed", "password_reset_failed"]);

function actionClass(action: string): string {
  if (FAIL_ACTIONS.has(action) || action === "delete" || action === "user_deactivated")
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  if (action === "login" || action === "create" || action === "user_activated")
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (action === "update")
    return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
  return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300";
}

/** "Who" cell text: the user, or the attempted username / console operator. */
function whoText(ev: AdminAuditEvent): string {
  if (ev.actor) return ev.actor_name || ev.actor_label;
  if (ev.action === "login_failed") return ev.actor_label ? `Tried “${ev.actor_label}”` : "Unknown user";
  return ev.actor_label || "System";
}

function ChangeValue({ value, redacted }: { value: unknown; redacted?: boolean }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (redacted || value === "[redacted]") {
    return (
      <Hint wrap label={AUDIT_HELP.redacted}>
        <span className="font-mono tracking-widest text-muted-foreground">••••</span>
      </Hint>
    );
  }
  let text: string;
  if (typeof value === "boolean") text = value ? "Yes" : "No";
  else if (Array.isArray(value)) text = value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}

function ChangesTable({ changes }: { changes: AuditChange[] }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="w-1/4 px-3 py-1.5 font-medium">Field</th>
            <th scope="col" className="px-3 py-1.5 font-medium">Before</th>
            <th scope="col" className="px-3 py-1.5 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={`${c.field}-${i}`} className="border-t align-top">
              <td className="px-3 py-1.5 font-medium" title={c.field}>{c.label || c.field}</td>
              <td className="px-3 py-1.5"><ChangeValue value={c.old} redacted={c.redacted} /></td>
              <td className="px-3 py-1.5"><ChangeValue value={c.new} redacted={c.redacted} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EXTRA_LABELS: Record<string, string> = {
  reason: "Reason",
  code: "Code",
  method: "Sign-in method",
  via: "Via",
  operation: "Operation",
  request: "Request",
  forwarded_for: "Forwarded-for chain",
  filters: "Filters",
  rows: "Rows exported",
  total: "Matching events",
  truncated: "Capped",
  error: "Error",
  emails_sent: "Reset emails sent",
};

function EventDetails({ ev }: { ev: AdminAuditEvent }) {
  const extras = Object.entries(ev.extra || {}).filter(
    ([, v]) => v !== "" && v !== null && v !== undefined,
  );
  return (
    <div className="space-y-3 px-2 py-2 text-sm">
      {ev.changes.length ? (
        <ChangesTable changes={ev.changes} />
      ) : (
        <p className="text-xs text-muted-foreground">No field-level changes recorded for this event.</p>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
        {extras.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{EXTRA_LABELS[k] ?? k}</dt>
            <dd className="break-words">
              <ChangeValue value={k === "via" && v === "platform_console" ? "Platform console" : v} />
            </dd>
          </Fragment>
        ))}
        {ev.object_id ? (
          <>
            <dt className="text-muted-foreground">Record id</dt>
            <dd className="break-all font-mono">{ev.object_id}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Browser</dt>
        <dd className="break-words">{ev.user_agent || "—"}</dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd>{new Date(ev.created_at).toISOString()}</dd>
      </dl>
    </div>
  );
}

function AuditRow({
  ev,
  open,
  onToggle,
}: {
  ev: AdminAuditEvent;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const object = [ev.object_type, ev.object_repr].filter(Boolean).join(" · ");
  const label = `${open ? AUDIT_HELP.collapse : AUDIT_HELP.expand}: ${ev.action_label}${ev.object_repr ? ` ${ev.object_repr}` : ""}`;
  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => onToggle(ev.id)} data-state={open ? "selected" : undefined}>
        <TableCell className="w-10 py-1">
          <IconButton
            label={label}
            aria-expanded={open}
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(ev.id);
            }}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          </IconButton>
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground" title={ev.created_at}>
          {fmtTime(ev.created_at)}
        </TableCell>
        <TableCell className="max-w-[200px] truncate" title={whoText(ev)}>
          {whoText(ev)}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={cn("whitespace-nowrap", actionClass(ev.action))}>
            {ev.action_label}
          </Badge>
        </TableCell>
        <TableCell className="max-w-[180px] truncate text-muted-foreground" title={ev.area}>
          {ev.area_label}
        </TableCell>
        <TableCell className="max-w-[320px] truncate" title={object || undefined}>
          {object || <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {ev.ip_address || "—"}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLS} className="bg-muted/20">
            <EventDetails ev={ev} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function HeadWithTip({ title, tip }: { title: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {title}
      <InfoTip label={`About ${title}`}>{tip}</InfoTip>
    </span>
  );
}

/** Tenant Settings → Audit log: filters, paginated table with expandable diffs, CSV export. */
export function AuditLog() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [rows, setRows] = useState<AdminAuditEvent[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);

  const badDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  const params = useMemo(() => toParams(filters), [filters]);
  const isDefault = useMemo(() => {
    const d = defaultFilters();
    return (Object.keys(d) as (keyof Filters)[]).every((k) => d[k] === filters[k]) && !search;
  }, [filters, search]);
  const cap = facets?.export_max_rows ?? DEFAULT_CAP;

  useEffect(() => {
    auditLogApi
      .facets()
      .then(setFacets)
      .catch(() => toast.error("Could not load the audit-log filters."));
  }, []);

  // Debounce the free-text box into the filters.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    if (badDates) return;
    const mine = ++seq.current;
    setLoading(true);
    auditLogApi
      .list({ ...params, page, page_size: pageSize })
      .then((data) => {
        if (mine !== seq.current) return;
        setRows(data.results);
        setCount(data.count);
      })
      .catch((e) => {
        if (mine !== seq.current) return;
        setRows([]);
        setCount(0);
        toast.error(e instanceof ItsmApiError ? e.message : "Could not load the audit log.");
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [params, page, pageSize, badDates]);

  useEffect(() => {
    load();
  }, [load]);

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function reset() {
    setSearch("");
    setFilters(defaultFilters());
    setPage(1);
  }

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function exportCsv() {
    setExporting(true);
    try {
      await auditLogApi.export(params);
      if (count > cap) {
        toast.warning(
          `Exported the newest ${cap.toLocaleString()} of ${count.toLocaleString()} events. Narrow the date range to export the rest.`,
        );
      } else {
        toast.success("Audit log exported.");
      }
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const rangeStart = count ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(count, page * pageSize);
  const exportDisabledReason = exporting ? AUDIT_HELP.exportBusy : badDates ? AUDIT_HELP.badDates : AUDIT_HELP.exportEmpty;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        What&apos;s recorded?
        <InfoTip label="What the audit log records">{AUDIT_HELP.whatsRecorded}</InfoTip>
        <span aria-hidden="true">·</span>
        Retention
        <InfoTip label="How long events are kept">{AUDIT_HELP.retention}</InfoTip>
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            From
            <InfoTip label="About the date range">{AUDIT_HELP.dates}</InfoTip>
          </span>
          <Input
            type="date"
            className="h-8 w-[9.5rem]"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => update("from", e.target.value)}
            aria-invalid={badDates || undefined}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            className="h-8 w-[9.5rem]"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => update("to", e.target.value)}
            aria-invalid={badDates || undefined}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Who
          <select className={cn(SELECT_CLASS, "max-w-[12rem]")} value={filters.actor} onChange={(e) => update("actor", e.target.value)}>
            <option value="">Anyone</option>
            {(facets?.actors ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Area
          <select className={cn(SELECT_CLASS, "max-w-[14rem]")} value={filters.area} onChange={(e) => update("area", e.target.value)}>
            <option value="">All areas</option>
            {(facets?.areas ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Action
          <select className={cn(SELECT_CLASS, "max-w-[12rem]")} value={filters.action} onChange={(e) => update("action", e.target.value)}>
            <option value="">All actions</option>
            {(facets?.actions ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Search
            <InfoTip label="What search matches">{AUDIT_HELP.search}</InfoTip>
          </span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              className="h-8 pl-8"
              placeholder="Record, username or id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the audit log"
            />
          </span>
        </label>
        <div className="flex items-center gap-2">
          <Hint label={isDefault ? AUDIT_HELP.resetDisabled : AUDIT_HELP.reset}>
            <Button variant="ghost" size="sm" onClick={reset} disabled={isDefault}>
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
          </Hint>
          <Hint label={exporting || badDates || count === 0 ? exportDisabledReason : AUDIT_HELP.export(cap)}>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || badDates || count === 0}>
              {exporting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Export CSV
            </Button>
          </Hint>
        </div>
      </div>
      {badDates ? <p className="text-xs text-destructive" role="alert">{AUDIT_HELP.badDates}</p> : null}

      {loading && !rows.length ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !rows.length ? (
        <EmptyState
          icon={ScrollText}
          title="No events match these filters"
          description="Try a wider date range or clear the other filters."
        />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border shadow-soft", loading && "opacity-60")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Details</span></TableHead>
                <TableHead>When</TableHead>
                <TableHead><HeadWithTip title="Who" tip={AUDIT_HELP.actor} /></TableHead>
                <TableHead><HeadWithTip title="Action" tip={AUDIT_HELP.action} /></TableHead>
                <TableHead><HeadWithTip title="Area" tip={AUDIT_HELP.area} /></TableHead>
                <TableHead><HeadWithTip title="Record" tip={AUDIT_HELP.object} /></TableHead>
                <TableHead><HeadWithTip title="IP address" tip={AUDIT_HELP.ip} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((ev) => (
                <AuditRow key={ev.id} ev={ev} open={expanded.has(ev.id)} onToggle={toggle} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {count > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p aria-live="polite">
            Showing {rangeStart}–{rangeEnd} of {count.toLocaleString()} {count === 1 ? "event" : "events"}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                className={SELECT_CLASS}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {totalPages > 1 ? (
              <nav className="flex items-center gap-1" aria-label="Pagination">
                <IconButton
                  label="Previous page"
                  disabledReason="Already on the first page"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                {pageList(page, totalPages).map((item, i) =>
                  item === "ellipsis" ? (
                    <span key={`e${i}`} className="px-2" aria-hidden="true">…</span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === page ? "default" : "outline"}
                      size="sm"
                      className="min-w-9"
                      onClick={() => setPage(item)}
                      disabled={loading}
                      aria-label={`Page ${item}`}
                      aria-current={item === page ? "page" : undefined}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <IconButton
                  label="Next page"
                  disabledReason="Already on the last page"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </nav>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
