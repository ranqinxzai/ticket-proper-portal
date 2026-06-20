# itsm-dashboards — DB Schema

**Status: BUILT.** Models in `models/models.py` (all extend `BaseModel`), migration
`migrations/0001_initial.py`. Field summaries below.

## `SavedFilter`
| Field | Type | Notes |
|---|---|---|
| `name` | CharField | |
| `query_spec` | JSONField | compiled to a `Q` by `query_builder` (whitelisted fields/ops) |
| `project` | FK → Project | null = cross-project |
| `owner` | FK → User | SET_NULL/CASCADE |
| `is_shared` | bool | |

## `Dashboard`
| Field | Type | Notes |
|---|---|---|
| `name` | CharField | |
| `owner` | FK → User | |

## `Widget`
| Field | Type | Notes |
|---|---|---|
| `dashboard` | FK → Dashboard | CASCADE, `related_name="widgets"` |
| `type` | CharField | kpi/pie/bar/trend/sla_gauge/ticket_list |
| `source` | JSONField | `{report:"sla-compliance"}` or `{saved_filter:<uuid>}` |
| `config` | JSONField | chart options |
| `x / y / w / h` | Int | react-grid-layout geometry |

## `DashboardShare`
| Field | Type | Notes |
|---|---|---|
| `dashboard` | FK → Dashboard | CASCADE, `related_name="shares"` |
| `user` / `role` / `group` | FK | one populated per share row |

## Notes
- `query_spec` is data, never executed code — `query_builder` translates it against a field/operator
  whitelist.
- Sharing grants visibility of the *dashboard*; the underlying ticket data is still RBAC-gated per
  viewer.
