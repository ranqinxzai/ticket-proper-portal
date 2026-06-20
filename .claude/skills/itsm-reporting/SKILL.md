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
- **Filters** — date range + project/group + group-by, applied uniformly across reports.
- **Helpdesk scoping** — `reports._base` and `sla_compliance` take a `helpdesk_ids` kwarg that ANDs
  `project__helpdesk_id__in` (ticket path on SLA), so reports only roll up the requester's accessible
  helpdesks. `ReportViewSet.retrieve` validates `?project` (403 if cross-helpdesk) and keeps the
  helpdesk clamp on the `TypeError` retry path (the clamp is never dropped).

## Frontend path / pages (planned)
`reports/[reportType]` with a `ReportShell` (date range + project/group filter + group-by) + Recharts
charts + a table + CSV download.

## API clients
`reports` (read-only, `ReportViewSet`):
- `GET reports/` → `{"reports": [sorted keys]}`.
- `GET reports/<name>/?project=&group=&date_from=&date_to=&days=` → `{"report": name, "data": ...}`.

The 8 report keys (from `services/reports.py` `REPORTS`): `open-tickets`, `by-status`,
`by-priority`, `by-group`, `agent-performance`, `sla-compliance`, `resolution-trends`,
`volume-trends`.

## RBAC module codes
- General reports → **`itsm.reports`**.
- SLA-compliance report → **`itsm.reports.sla`**.
- Agent-performance report → **`itsm.reports.agent`**.
All three are seeded; Agents have read/create/update on the report modules (effectively run reports).

## Key files
`services/reports.py` (live aggregates — the `REPORTS` dict), `services/widget_data.py`
(`resolve(widget, user)` — used by dashboard widgets), `views.py` (`ReportViewSet`, module
`itsm.reports`), `urls.py` (registers `reports`). No `models/` and no nightly aggregation job exist —
snapshot tables + scheduler job remain a deferred optimization.
