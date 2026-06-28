# itsm-reporting

## Purpose
Standard ITSM reports: live aggregate query services for charts/tables. **Status: BUILT** (live
query services) — `backend/apps/itsm_reporting/services/reports.py` + `services/widget_data.py`
expose live aggregates over `Ticket` (+ `SLATracker` when present) through `ReportViewSet`.
Nightly snapshot tables (`TicketDailyStat`/`AgentDailyStat`/`SLAComplianceStat`) are **not** built —
they remain a deferred performance optimization; the app intentionally has no models/tables today.
The RBAC modules (`itsm.reports.sla`, `itsm.reports.agent`) are seeded.

## Backend app path
`backend/apps/itsm_reporting/` (BUILT — live query services in `services/reports.py` +
`services/widget_data.py`; snapshot models remain a deferred optimization, not built).

## Key concepts
- **Live report query services** — read-only aggregates over `Ticket` (and SLA trackers), returning
  chart-ready JSON (one RO action per standard report: volume/trend, by-status, by-priority,
  by-group, SLA compliance, agent performance, resolution time, backlog, reopen rate).
- **Nightly snapshot tables (deferred, not built)** — `TicketDailyStat`, `AgentDailyStat`,
  `SLAComplianceStat` would be populated by an APScheduler nightly job so trend reports don't re-scan
  the hot table. This optimization is not implemented; trends currently compute live.
- **Filters** — explicit From–To **date range** + project/group, applied uniformly across reports.
  The range is **capped at 6 months** (`views.MAX_RANGE_DAYS=186`); a request with **both**
  `date_from` and `date_to` spanning more (or reversed/invalid) returns **400** (`_validate_range`).
  Open-ended `days`-only requests (the dashboard) are exempt. Date bounds use `__date__gte/__date__lte`
  lookups so the `to` day is **inclusive** of the whole day (a `created_at__lte=<date>` would truncate
  to midnight and drop that day's tickets). The day boundary is the **server tz** day —
  `settings.TIME_ZONE` is UTC, so it's the UTC calendar day, not the viewer's local day (a few
  tickets near a tz day-edge attribute to the adjacent UTC day; fine given UTC storage everywhere). `created_vs_resolved`/`volume-trends`/
  `resolution-trends` honour the explicit range (`_window` → `_daily`), falling back to `days` back
  from today when no range is given; `sla-compliance` filters by `ticket__created_at` over the range.
- **Helpdesk scoping** — `reports._base` and `sla_compliance` take a `helpdesk_ids` kwarg that ANDs
  `project__helpdesk_id__in` (ticket path on SLA), so reports only roll up the requester's accessible
  helpdesks. The view builds the clamp via `itsm_helpdesks.services.resolve_helpdesk_scope(user,
  ?helpdesk, request=request)`: with `?helpdesk=<id|key>` it **narrows to that one workspace**
  (when accessible — never widens, never 403s); without it, the clamp is every accessible helpdesk.
  `?project` is still validated (403 if cross-helpdesk). `_run()` keeps the helpdesk clamp **and**
  the date filters on the `TypeError` retry — only the unsupported extra (`days`, taken solely by the
  trend reports) is dropped, so a period filter still applies to the distribution reports.
- **Raw "Ticket Data" report (`ticket-data`, added 2026-06-24)** — a flat per-ticket export sitting
  **first** in the catalog. `reports.ticket_data(**f)` reuses `_base` (so it honours the same
  project/group/date/helpdesk filters + Guard-5 scoping) and returns a **column manifest** rather than
  a plain list: `{"columns": [{"key","label","type"}], "rows": [{key: value}], "truncated": bool}`.
  Columns are **dynamic** = standard + system/timeline fields → flattened SLA-tracker columns (per
  present `SLAMetric.kind`: state/due/breached/breached_at/target) → custom-field columns (`cf_<key>`,
  label = the field's display name; when a single `?project=` is set, ALL that project's defined fields
  appear even when empty, else only fields with a value somewhere in the set). SLA + custom values are
  **batch-fetched** (no N+1); the result is capped at `_TICKET_DATA_MAX_ROWS=5000` (`truncated` then
  true — the UI shows a "narrow the range" note). The export (`export._section`) and the frontend both
  render straight from the `columns` manifest, so screen = file. `type` (`datetime|bool|number|text`)
  drives client/Excel formatting.
- **Standard reports catalog** — `reports.STANDARD_REPORTS` is the curated, ordered list of the 11
  report keys surfaced in the UI (a subset of `REPORTS`; the raw `volume-trends`/`resolution-trends`
  series stay in `REPORTS` for the Dashboard tab but are replaced in the catalog by the combined
  `created-vs-resolved` table). New tabular reports added alongside the originals:
  `created-vs-resolved` (date·created·resolved·net), `resolution-time-by-priority` (avg/min/max h),
  `sla-breach-list` (per-ticket breached rows, capped 1000), `backlog-aging` (open tickets bucketed by
  age 0-1d/1-3d/3-7d/7-30d/>30d).
- **Export (xlsx + csv, no PDF)** — `services/export.py` (openpyxl only; **reportlab removed**):
  `build_workbook(report_data, …)` renders one sheet per report — used for both a single report
  (`{key: data}`) and the combined pack; `build_csv(report_key, data)` renders one report as a single
  UTF-8-BOM CSV. Both go through `_section()` so the file matches the screen. Endpoints:
  `GET reports/<name>/export/?format=xlsx|csv` (single report) and `GET reports/export/?format=xlsx`
  (combined Excel workbook over `STANDARD_REPORTS`; rejects `format=csv` — CSV is per-report only).
  **Content-negotiation fix (2026-06-24):** `?format=` is *our* export-type param but collides with
  DRF's `URL_FORMAT_OVERRIDE` (default `'format'`), which 404'd every export (no xlsx/csv renderer
  registered) **before** the view body ran. `ReportViewSet` now pins `renderer_classes=[JSONRenderer]`
  + a `ReportContentNegotiation.select_renderer` that always returns the JSON renderer, so file
  responses (raw `HttpResponse`) and JSON error/`retrieve` responses both work and `?format=` is read
  only by the view. Without this the Download buttons silently 404.

## Frontend path / pages (BUILT)
- **Per-workspace reports = rows console + detail (plain tables, no dashboard styling)** — the
  "Reports" tab (`components/agent/workspace/workspace-tabs.tsx`):
  - **Console index** `…/reports/page.tsx` (rebuilt 2026-06-24) — a "traditional" **one-row-per-report
    table** (no category cards). Each row carries its own inline controls: **Report** (title +
    one-line description + a muted category tag), a **Project** select (default **All projects**), a
    **Date range** (two `<input type="date">`, From–To, default = **current month**: 1st → today,
    capped at 6 months — the `to` input's `max` is `addMonths(from,6)` and a per-row red error shows
    when `rangeError` trips), a **Download** dropdown (Excel `.xlsx` / CSV `.csv` → `reportsApi.exportOne`),
    and a **Generate Report** button (navigates to the detail page with `?project=&from=&to=`). A top
    **Export all (Excel)** button still emits the combined pack, scoped to **all projects · current
    month**. No KPI tiles, no charts.
  - **Detail** `…/reports/[reportType]/page.tsx` — one report rendered as a plain table
    (`components/ui/table.tsx`), scoped by the project + From–To range (initialised from the console
    link's `?project=&from=&to=` params, default current month), with **Excel** and **CSV** download
    buttons. Range validated client-side (`rangeError`); fetch/export are skipped + buttons disabled
    while invalid. Validates `reportType` against the catalog (`notFound()` otherwise).
  - Catalog config lives in `components/reports/catalog.ts` (`REPORT_DEFS` → key·title·context·
    category·columns·rows-transform; `MAX_RANGE_MONTHS=6`, `currentMonthRange()`, `maxToDate()`,
    `rangeError()`, `buildRangeScope()` — the old `PERIODS`/`buildScope` were removed). The shared
    project + From/To filter (detail page) is `components/reports/report-filters.tsx`. Keep keys in
    sync with `reports.STANDARD_REPORTS`.
- **Global**: `app/t/[org]/(agent)/agent/reports/page.tsx` — same reports across all accessible
  helpdesks (no `?helpdesk=`), no export yet.
- **Workspace dashboard (command center)**: `app/t/[org]/(agent)/agent/w/[helpdeskKey]/dashboard/page.tsx`
  — the helpdesk's at-a-glance landing tab. It is a **consumer of these same 8 report endpoints**
  (not its own backend): hero KPIs (Open / Created / Resolved / Avg-resolution) with period-over-period
  deltas, a Created-vs-Resolved trend, an SLA gauge, status/priority/team distributions, an agent
  leaderboard and a projects list. **Period-over-period** is computed client-side by fetching the trend
  reports with `days = period × 2` and splitting the daily series at the period boundary (no extra
  endpoint). State KPIs (open/status/priority/group/SLA) are fetched **without** a date filter so they
  show live current state; only the trend/leaderboard calls pass `date_from`/`days`. The
  **"Needs attention"** tiles (unassigned / overdue / SLA at-risk / SLA breached) are derived from a
  scoped `ticketsApi.list({project})` fetch using each row's `sla` RAG payload (`amber` = at-risk,
  `breached` flag = breached). The queue page does **not** read URL filter params, so these tiles are
  count cards, not deep-links.
- Shared presentational pieces (no charting dep): `components/reports/report-views.tsx` —
  base set `ReportCard`, `BarList`, `StatTile`, `MiniTable`, `TrendChart`; command-center set
  `KpiCard` (+ `Sparkline`/`DeltaBadge`/`pctChange`), `DonutChart`, `GaugeChart` (semicircular,
  ≥90 success / ≥75 warning / else destructive band), `DualTrendChart` (two overlaid series),
  `AlertTile`, and the `CHART_PALETTE` (`--chart-1..6` tokens). All hand-rolled SVG — **no charting
  dependency** was added.

## API clients
`reportsApi` (`lib/itsm/api.ts`):
- `reportsApi.get(name, params)` → `GET reports/<name>/?helpdesk=&project=&group=&date_from=&date_to=&days=`.
- `reportsApi.exportOne(name, "xlsx"|"csv", params)` → `GET reports/<name>/export/?format=…&<scope>`.
- `reportsApi.exportAll(params)` → `GET reports/export/?format=xlsx&<scope>` (combined workbook).
  Both downloads go via `itsmClient.download()` (authed blob fetch + `saveBlob()` in `lib/itsm/client.ts`).
- `GET reports/` → `{"reports": [sorted keys]}`.

`REPORTS` keys (from `services/reports.py`): `ticket-data`, `open-tickets`, `by-status`, `by-priority`,
`by-group`, `agent-performance`, `sla-compliance`, `resolution-trends`, `volume-trends`,
`created-vs-resolved`, `resolution-time-by-priority`, `sla-breach-list`, `backlog-aging`. The UI catalog
(`STANDARD_REPORTS`) surfaces 11 of these (the two raw trend series are dashboard-only).

The frontend catalog (`components/reports/catalog.ts`) supports a `columnsFromData?(data)` hook on a
`ReportDef`: when set (only `ticket-data` today) the detail table derives its columns from the payload's
`columns` manifest instead of the static `columns` array. The detail page uses `def.columnsFromData ??
def.columns` and surfaces the `truncated` flag.

## RBAC module codes
- General reports → **`itsm.reports`**.
- SLA-compliance report → **`itsm.reports.sla`**.
- Agent-performance report → **`itsm.reports.agent`**.
All three are seeded; Agents have read/create/update on the report modules (effectively run reports).

## Key files
`services/reports.py` (live aggregates — the `REPORTS` dict + `STANDARD_REPORTS` order),
`services/export.py` (openpyxl xlsx + stdlib-csv renderers), `services/widget_data.py`
(`resolve(widget, user)` — used by dashboard widgets), `views.py` (`ReportViewSet` — `retrieve` +
`export_single` + combined `export` actions, module `itsm.reports`), `urls.py` (registers `reports`).
No `models/` and no nightly aggregation job exist — snapshot tables + scheduler job remain a deferred
optimization.
