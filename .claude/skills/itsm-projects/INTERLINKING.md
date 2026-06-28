# itsm-projects — Interlinking

## Depends on
- **itsm-core** — `BaseModel`.
- **itsm-workflows** — `Project.default_workflow` (PROTECT); the seed resolves it by `base_type`.
- **itsm-groups** — `Project.default_group` (SET_NULL); the seed resolves Service Desk by key.
- **itsm-dashboards** (runtime, no FK) — the **Filters** settings tab manages project-scoped
  `SavedFilter`s; `ProjectWriteSerializer.validate_default_view_key` checks a `saved:<uuid>` reference
  against `SavedFilter`. Per-agent default views live in `QueueViewPreference`.

## Depended on by
- **itsm-tickets** — `Ticket.project` (PROTECT) + `Ticket.ticket_type` (PROTECT);
  `TicketSequence` is OneToOne to Project; numbering uses `project.key`. `create_ticket` reads
  `project.default_workflow` and `project.default_group`.
- **itsm-fields** — `FieldDefinition.project` and `FieldLayout.project`/`.ticket_type` scope custom
  fields and layouts to a project/type.
- **itsm-groups** — `RoutingRule.project` (nullable) scopes routing to a project.
- **itsm-sla / itsm-notifications / itsm-reporting / itsm-dashboards** — scope policies, schemes,
  reports and filters by project (planned FKs / query filters).

## Seed order
Runs **after** workflows and groups (so the FKs resolve) and **before** tickets.
