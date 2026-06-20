# itsm-projects

## Purpose
The top-level container, now owned by a **Helpdesk** (department/workspace — see itsm-helpdesks).
A `Project` owns a `helpdesk` (non-null FK), a key, a type, its default group and workflow, and a
set of `TicketType`s. Each active helpdesk is seeded its OWN default **Incident** + **Request**
projects (so IT's Incident ≠ HR's), each wired to the matching default workflow + the helpdesk's own
Service Desk group, with starter ticket types. Keys are helpdesk-prefixed (e.g. `ITINC`, `ITREQ`,
`HRINC`, `HRREQ`) so they stay globally unique and become the ticket-number prefix.

## Backend app path
`backend/apps/itsm_projects/`

## Key concepts
- **`Project`** — `helpdesk` (FK Helpdesk, **CASCADE**, `related_name="projects"`, non-null), `name`,
  globally-unique `key` (2–10 uppercase, validated by `KEY_VALIDATOR`),
  `project_type` (incident / service_request / custom), `status` (active/inactive), `color`/`icon`,
  `default_group` (FK Group, SET_NULL), `default_workflow` (FK Workflow, **PROTECT**), `lead`,
  `created_by`. The `key` becomes the ticket-number prefix (`ITINC-1`). A **partial UniqueConstraint
  `(helpdesk, project_type)`** (WHERE type ∈ incident/service_request AND `is_deleted=False`) enforces
  exactly one default Incident + one default Request per helpdesk; CUSTOM projects are unconstrained.
- **`TicketType`** — per-project ticket flavor (Incident, Hardware, Access Request…) with a
  `base_category` (incident / service_request), optional parent, `is_default`, `is_active`,
  `sort_order`. Unique `(project, key)`.
- **Config attaches via FKs.** SLA policy / notification scheme / field layout / calendar are
  added to `Project` in later milestones (M3/M5/M6) so each migration stays self-contained.

## Frontend path / pages (planned)
`projects/[projectKey]` (overview), `admin/projects/[projectKey]/...` (the config hub:
fields, workflows, slas, notifications, groups, canned-notes, templates).

## API clients
`/api/v1/itsm/projects`, `/api/v1/itsm/ticket-types`.

## RBAC module codes
- `ProjectViewSet` → **`itsm.projects`** (Agent: read-only; Supervisor: full). `get_queryset` is
  **helpdesk-scoped**: filtered to the requester's accessible helpdesks and clamped by the advisory
  `?helpdesk=<id|key>` param (superusers unrestricted); `perform_create` rejects (403) a helpdesk the
  creator can't access. Serializer exposes `helpdesk`/`helpdesk_key`/`helpdesk_name`/`project_type`.
- `TicketTypeViewSet` → **`itsm.projects.config`** (config-level; Supervisor only by default).

## Key files
- `models.py` — `Project`, `TicketType`, `ProjectType`, `KEY_VALIDATOR`.
- `views.py` — `ProjectViewSet` (read/write serializer split), `TicketTypeViewSet`.
- `serializers.py` — `ProjectSerializer` / `ProjectWriteSerializer` / `TicketTypeSerializer`.
- `urls.py` — registers `projects`, `ticket-types`.
- `seed.py` — loops active helpdesks, seeding each helpdesk's `<KEY>INC` + `<KEY>REQ` projects, wiring
  the shared default workflow + the helpdesk's Service Desk group and ticket types (idempotent).
