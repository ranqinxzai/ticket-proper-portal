# itsm-reporting — User Flows

## Flow A — Run a standard report (rows console, rebuilt 2026-06-24)
1. Agent opens the **Reports** tab → a one-row-per-report table. Each row defaults to **All projects**
   + the **current month** (From = 1st, To = today).
2. On a row the agent optionally narrows the **Project** and edits the **From–To** dates (capped at
   6 months; a longer span shows a red per-row error and disables the actions).
3. **Generate Report** → opens `reports/[reportType]?project=&from=&to=` → `GET reports/<name>/?project=
   &date_from=&date_to=` → the report renders as a plain table (no charts).
4. **Download** (dropdown) → `GET reports/<name>/export/?format=xlsx|csv&project=&date_from=&date_to=`
   → file saved via `itsmClient.download()`. The top **Export all (Excel)** button emits the combined
   workbook (all projects · current month).

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
