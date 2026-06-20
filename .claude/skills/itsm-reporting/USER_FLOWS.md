# itsm-reporting — User Flows

## Flow A — Run a standard report
1. Agent opens `reports/[reportType]` (e.g. SLA compliance).
2. `ReportShell` sets a date range + project/group filter + group-by.
3. `GET reports/sla-compliance/?from&to&project&group_by` → chart-ready JSON.
4. Recharts renders the chart + a table; the agent exports CSV (`?format=csv`).

## Flow B — Trend over time
1. `GET reports/volume-trends/?days=90` (or `resolution-trends`).
2. The service computes the daily series **live** over `Ticket`. (Reading pre-computed
   `TicketDailyStat` snapshots instead is a deferred optimization — not built.)

## Flow C — Agent performance
1. Supervisor opens the agent-performance report.
2. `GET reports/agent-performance/` returns per-agent resolved/open counts + avg resolution hours,
   computed live over `Ticket` (no `AgentDailyStat` table involved).

## Flow D — Nightly aggregation (deferred, not built)
When the snapshot tier is added, an `aggregate_nightly` job would upsert the day's
`TicketDailyStat` / `AgentDailyStat` / `SLAComplianceStat` rows so trend reports are instant. This
job does not exist yet; trends currently compute live.
