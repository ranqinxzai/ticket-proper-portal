# Dashboard & Reporting Framework — ITSM Platform

Design for `itsm_dashboards` (planned, **M10**) and `itsm_reporting` (planned, **M9**). The shared primitive is **`SavedFilter.query_spec`** — a JSON query compiled to a Django `Q` by the `query_builder` service — which powers saved queues, dashboard widgets, and report scoping.

---

## 1. SavedFilter & `query_spec`

A `SavedFilter` is a named, shareable ticket query. Its `query_spec` is a structured JSON document that `query_builder` translates to an ORM `Q` (and ordering). It serves three consumers: saved **queues**, dashboard **widgets**, and report **filters**.

```jsonc
// SavedFilter.query_spec
{
  "all": [                                  // AND
    { "field": "project", "op": "eq", "value": "<project-uuid>" },
    { "field": "status.category", "op": "in", "value": ["todo", "in_progress"] },
    { "field": "priority", "op": "in", "value": ["critical", "high"] }
  ],
  "any": [                                  // OR (optional)
    { "field": "assignee", "op": "eq", "value": "<me>" },
    { "field": "assigned_group", "op": "eq", "value": "<group-uuid>" }
  ],
  "order_by": ["-priority", "-updated_at"]
}
```

Supported operators (target set): `eq`, `ne`, `in`, `gt`/`gte`/`lt`/`lte` (dates/numbers), `isnull`, `contains` (text). `query_builder` whitelists fields/ops (no arbitrary ORM access) and maps `status.category` → `status__category__key`, `me` → the request user, etc. This keeps queries safe and reuses the `Ticket` indexes.

| Model | Key fields |
|---|---|
| **`SavedFilter`** | `name`, `owner`, `project` (optional), `query_spec` (JSON), `is_shared`. |

## 2. Dashboard Model

| Model | Key fields |
|---|---|
| **`Dashboard`** | `name`, `owner`, `layout` (grid positions), `is_default`. |
| **`Widget`** | `dashboard` (FK), `type`, `title`, `saved_filter` (FK, optional), `config` (JSON: chart options, group‑by, metric), `grid` (x/y/w/h). |
| **`DashboardShare`** | `dashboard` (FK), `principal` (user / role / group), `can_edit`. |

## 3. Widget Types

| Type | Renders | Backing |
|---|---|---|
| `kpi` | single number + delta | count/aggregate over a `SavedFilter` |
| `pie` | distribution (by status / priority / group) | group‑by aggregate (Recharts pie) |
| `bar` | comparative bars (by assignee / type) | group‑by aggregate (Recharts bar) |
| `trend` | time series (created vs resolved) | daily snapshot / live aggregate (Recharts line) |
| `sla_gauge` | SLA compliance % | `SLAComplianceStat` / live |
| `ticket_list` | a compact queue | `SavedFilter` rows |

## 4. Drag‑Grid & Sharing (frontend)

- **`react-grid-layout`** powers the draggable/resizable grid; edit mode persists `Widget.grid` + `Dashboard.layout`.
- A **widget registry** maps `type` → React component (Recharts under the hood).
- **Sharing:** `DashboardShare` grants view/edit to a user, role, or group; the API filters dashboards a caller can see.
- API surface (M10): `/saved-filters`, `/dashboards`, `/widgets` (registered in `itsm_dashboards/urls.py`), gated by `itsm.dashboards` / `itsm.dashboard`.

## 5. Reporting (`itsm_reporting`, M9)

Two layers:
- **Live query services** — compute a report on demand from the ticket tables (filtered/grouped), returning **chart‑ready JSON** (+ CSV export).
- **Nightly snapshot tables** for fast historical/trend reporting, populated by `reporting.aggregate_nightly`:
  - `TicketDailyStat` — per‑day volume (created / resolved / open) by project/type/priority.
  - `AgentDailyStat` — per‑agent throughput / open load.
  - `SLAComplianceStat` — per‑day SLA met/breached by metric.

The reports router is exposed (`itsm_reporting/urls.py` registers a `ReportViewSet`); each standard report is a read‑only action returning chart‑ready JSON. Gated by `itsm.reports` (+ `.sla`, `.agent`).

## 6. Standard Reports

| Report | What it shows | Module |
|---|---|---|
| **SLA Compliance** | % met vs breached by metric/priority/group over a range. | `itsm.reports.sla` |
| **Agent Performance** | tickets resolved, avg resolution time, open load per agent. | `itsm.reports.agent` |
| **Ticket Volume & Trend** | created vs resolved over time; backlog growth. | `itsm.reports` |
| **Status / Priority Distribution** | current mix across the queue. | `itsm.reports` |
| **Group Workload** | open tickets and SLA risk by group. | `itsm.reports` |
| **First‑Response Performance** | first‑response SLA attainment. | `itsm.reports.sla` |

## 7. ReportShell (frontend)
`ReportShell` provides a consistent frame: date‑range picker + project/group filter + group‑by selector → Recharts visualization + a data table + a **CSV export** button. All standard reports plug into it.

## 8. Reuse Notes
- The **same `query_spec`** drives queues, widgets, and reports — one mental model, one compiler (`query_builder`), one whitelist.
- Widgets and live reports reuse the `Ticket` composite indexes for speed; trend/historical widgets prefer the nightly snapshot tables.
