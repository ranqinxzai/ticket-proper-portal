# itsm-reporting — DB Schema

**Status: no tables — by design.** The reporting app is built but intentionally owns **no models or
tables** (`models/__init__.py` is empty; the `migrations/` dir has only `__init__.py`). Reports
compute **live** by aggregating `Ticket`/`SLATracker`. This is current reality, not a missing build.

The snapshot tables below remain a **planned/deferred optimization** (likely plain indexed models
keyed by date; may use `BaseModel`) — they are **not built**.

## `TicketDailyStat` (per day × dimension)
`date` (db_index), `project` (FK), `group` (FK, null), `priority` (null), `status_category`,
`created_count`, `resolved_count`, `closed_count`, `open_backlog`, `reopened_count`. Upserted nightly
per `(date, project, group, priority)`.

## `AgentDailyStat` (per day × agent)
`date`, `agent` (FK User), `project` (FK, null), `assigned_count`, `resolved_count`,
`first_response_avg_minutes`, `resolution_avg_minutes`. Drives agent-performance reports.

## `SLAComplianceStat` (per day × metric)
`date`, `project` (FK), `metric`, `met_count`, `breached_count`, `compliance_pct`. Drives the SLA
compliance trend.

## Indexes (intended)
`(date, project)` on each; `(date, agent)` on AgentDailyStat. Upsert key = the dimension tuple +
`date`, so the nightly job is idempotent (re-run/catch-up safe).

## Notes
Snapshots are derived data — they can be rebuilt from `Ticket`/`AuditEvent`/`SLATracker` history if
ever corrupted.
