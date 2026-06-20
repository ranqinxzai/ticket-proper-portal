# itsm-core — Interlinking

itsm_core is the **base of the dependency tree** — every other ITSM app imports from it; it
imports from none of them (except lazy, optional hooks).

## Who depends on itsm-core
- **All apps** → `BaseModel` (and the soft-delete mixins) for their models.
- **itsm-tickets / itsm-workflows** → `log_event`, `sanitize_html`/`html_to_text`, `hooks`.
- **itsm-rbac** → `BaseModel` for `Module`/`SystemRole`/`RoleModulePermission`/`RoleAssignment`.
- **itsm-fields** → its models physically live in `itsm_core/models/fields.py`.
- **`seed_itsm`** → orchestrates `itsm_rbac`, `itsm_workflows`, `itsm_sla`,
  `itsm_notifications`, `itsm_groups`, `itsm_tickets`, `itsm_projects` seeds.

## What itsm-core depends on (loosely, via hooks only)
- **itsm-sla** — `sla_engine.start_trackers / on_status_change / pause / resume / stop`
  (lazy import; no-op until built).
- **itsm-notifications** — `bus.emit` (lazy import; no-op until built).

The hook seam is the *only* coupling, and it is one-directional and optional — core works
standalone if neither engine exists.
