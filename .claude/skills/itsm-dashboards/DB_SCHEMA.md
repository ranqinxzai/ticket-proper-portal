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

## `QueueColumnPreference` (per-user queue columns; migration `0003`)
| Field | Type | Notes |
|---|---|---|
| `owner` | FK → User | CASCADE, `related_name="itsm_queue_columns"` |
| `project` | FK → Project | CASCADE, `related_name="queue_column_prefs"` |
| `columns` | JSONField | ordered column keys; empty ⇒ fall back to project/built-in default |

Unique alive `(owner, project)` (`uniq_owner_project_columns`); index `(owner, project)`.

## `QueueViewPreference` (per-user default queue view; migration `0004`)
| Field | Type | Notes |
|---|---|---|
| `owner` | FK → User | CASCADE, `related_name="itsm_queue_views"` |
| `project` | FK → Project | CASCADE, `related_name="queue_view_prefs"` |
| `view_key` | CharField(64) | blank; system view key (`"open"`/`"all"`/…) or `"saved:<uuid>"`; blank ⇒ project/product default |

Unique alive `(owner, project)` (`uniq_owner_project_view`); index `(owner, project)`. Mirrors
`QueueColumnPreference`.

## Notes
- `query_spec` is data, never executed code — `query_builder` translates it against a field/operator
  whitelist.
- Sharing grants visibility of the *dashboard*; the underlying ticket data is still RBAC-gated per
  viewer.
