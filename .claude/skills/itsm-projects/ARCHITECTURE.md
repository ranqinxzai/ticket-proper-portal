# itsm-projects — Architecture

## Layout
```
itsm_projects/
  models.py       # Project, TicketType, ProjectType, KEY_VALIDATOR
  serializers.py  # read (ProjectSerializer) / write (ProjectWriteSerializer) / TicketTypeSerializer
  views.py        # ProjectViewSet, TicketTypeViewSet
  urls.py         # projects, ticket-types
  seed.py         # run(): INC + REQ + ticket types
```

## Design decisions
- **`key` is the identity an agent sees and the ticket-number prefix.** Validated
  `^[A-Z][A-Z0-9]{1,9}$` and unique. `Ticket.ticket_number` = `f"{key}-{n}"`.
- **`default_workflow` is PROTECT, `default_group` is SET_NULL.** You cannot delete a workflow a
  project relies on (tickets would be left without a lifecycle), but a group can vanish (tickets
  fall back to no default group). The *Ticket* snapshots its workflow at create time, so editing
  the project default never re-points in-flight tickets.
- **Config FKs deferred to later milestones.** The model intentionally omits `sla_policy` /
  `notification_scheme` / `field_layout` / `calendar` FKs at M1 so each engine's migration is
  self-contained; they're added when those engines land. The project config hub assembles them.
- **Read/write serializer split.** `get_serializer_class` returns `ProjectWriteSerializer` for
  create/update and `ProjectSerializer` for reads (so reads can nest computed/related data without
  it being writable). `perform_create` stamps `created_by` from the request user.
- **`TicketType` is project-scoped** with unique `(project, key)` and a self-FK `parent` for
  sub-types. `base_category` ties a type to incident vs service-request semantics for reporting.

## Seeding
`seed.py::run()` runs after the workflows + groups seeds. For each of INC/REQ it finds the default
workflow by `base_type` and the Service Desk group by key, `get_or_create`s the project, refreshes
the workflow/group wiring on re-run, and upserts the ticket types. Idempotent.
