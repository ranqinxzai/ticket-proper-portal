# itsm-reporting — API Contracts

**Status: BUILT** (live query services via `ReportViewSet`). Base `/api/v1/itsm/`. All read-only.
Reports compute live over `Ticket` (+ `SLATracker`); there are no snapshot tables.

## Reports (RO) — module `itsm.reports`
`ReportViewSet` (a DRF `ViewSet`, not `ModelViewSet`):
- `GET reports/` → `{ "reports": [sorted report keys] }`.
- `GET reports/<name>/?project=&group=&date_from=&date_to=&days=` → `{ "report": <name>, "data": ... }`.

The available report names (keys in `services/reports.py` `REPORTS`):
- `open-tickets` — `{ total, by_project:[{project__key, n}] }`.
- `by-status`, `by-priority`, `by-group` — categorical breakdowns (`[{label, value, ...}]`).
- `sla-compliance` — `{ total, met, breached, compliance_pct }` (reads `SLATracker` when present).
- `agent-performance` — per-agent `[{agent, resolved_count, open_count, avg_resolution_hours}]`.
- `resolution-trends`, `volume-trends` — daily series `[{date, value}]` over the last `days` (30).

### Query params
`?project=<uuid>&group=<uuid>&date_from=<ISO>&date_to=<ISO>&days=<int>`. Reports that don't accept a
given param (e.g. `days` on a non-trend report) ignore it (the view retries without extras).

### Snapshot/trend endpoints (deferred, not built)
Pre-aggregated snapshot endpoints (`TicketDailyStat`/`AgentDailyStat`/`SLAComplianceStat`) and a
`?format=csv` export are not implemented — they remain a deferred optimization. Trends currently
compute live.

## Error codes (intended)
- `403` — lacking the report module grant (e.g. non-granted role on `itsm.reports.sla`).
- `400` — invalid date range / unknown `group_by`.
