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
- `sla-compliance` — `{ total, met, breached, compliance_pct }` (reads `SLATracker`; honours the range
  via `ticket__created_at`).
- `agent-performance` — per-agent `[{agent, resolved_count, open_count, avg_resolution_hours}]`.
- `resolution-time-by-priority`, `backlog-aging`, `sla-breach-list`, `created-vs-resolved` — tabular.
- `resolution-trends`, `volume-trends` — daily series `[{date, value}]`; window = explicit
  `date_from`/`date_to` when given, else the last `days` (30).

### Query params
`?helpdesk=<id|key>&project=<uuid>&group=<uuid>&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&days=<int>`.
Reports that don't accept a given param (e.g. `days` on a non-trend report) ignore it (the view retries
without extras). Date bounds are **day-inclusive** (`__date__gte/__date__lte`), so `date_to` covers the
whole `to` day. **Range cap:** when **both** bounds are present they must be ≤ 6 months
(`MAX_RANGE_DAYS=186`) and ordered, else **400**. `days`-only (open-ended) requests are exempt.

### Export (BUILT)
- `GET reports/<name>/export/?format=xlsx|csv&<scope>` → one report as Excel (one sheet) or CSV.
- `GET reports/export/?format=xlsx&<scope>` → combined workbook over `STANDARD_REPORTS` (xlsx only;
  `format=csv` → 400). Same scope params + the 6-month cap apply.
- Built via `services/export.py` (openpyxl + stdlib csv). Downloads go through `itsmClient.download()`.
- **Content negotiation:** `ReportViewSet` pins `renderer_classes=[JSONRenderer]` +
  `ReportContentNegotiation` so `?format=` is treated as the export-type param (not DRF's
  `URL_FORMAT_OVERRIDE`); without it every export 404'd before the view ran.

### Snapshot/trend tables (deferred, not built)
Pre-aggregated snapshot tables (`TicketDailyStat`/`AgentDailyStat`/`SLAComplianceStat`) are not
implemented — a deferred optimization. Trends compute live.

## Error codes
- `403` — lacking the report module grant (e.g. non-granted role on `itsm.reports.sla`), or a
  `?project` in a helpdesk you can't access.
- `400` — range > 6 months, reversed/invalid `date_from`/`date_to`, bad `format`.
- `404` — unknown report name.
