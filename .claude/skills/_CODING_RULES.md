# ITSM Coding Rules & Conventions

Conventions every ITSM module follows. Grounded in real code under
`backend/apps/itsm_*`. **When the code and this doc disagree, the code wins.**

## 1. UUID primary keys everywhere
Every model PK is a `UUIDField(default=uuid.uuid4, editable=False)` via `UUIDModel`
(`backend/apps/itsm_core/models/base.py`). UUIDs are stable external identifiers that don't
leak row counts in URLs / webhooks / email deep-links. (Exception: `TicketSequence` is a plain
`models.Model` keyed by a OneToOne to `Project` — it's an internal counter, not an entity.)

## 2. `BaseModel` = timestamps + soft delete
Domain models extend `apps.itsm_core.models.BaseModel` = `UUIDModel + TimeStampedModel +
SoftDeleteModel`. That gives `id`, `created_at`/`updated_at`, and `is_deleted`/`deleted_at`/
`deleted_by`. The default manager (`objects`) is a `SoftDeleteManager` that returns only
`is_deleted=False`; use `Model.all_objects` to reach soft-deleted rows.

## 3. Soft-delete on destroy
`ItsmModelViewSet.perform_destroy` calls `instance.soft_delete(user=...)` when the model has
that method (all `BaseModel` subclasses), else a hard delete. **DELETE never removes the row.**
Querysets in ViewSets filter `is_deleted=False` explicitly as a belt-and-braces measure.

## 4. Services layer = single choke-points (NO business logic in views)
All multi-step writes go through a service so there is exactly one sanctioned write site:
- `itsm_tickets/services/ticket_service.py` — `create_ticket` / `assign` / `add_comment`
- `itsm_tickets/services/numbering.py` — `generate_ticket_number`
- `itsm_workflows/services/engine.py` — `transition` (+ `available_transitions`)
- `itsm_groups/services.py` — `resolve_assignee` / `resolve_group_and_assignee` / round-robin
- (planned) `itsm_sla.services.sla_engine`, `itsm_notifications.services.bus` + `outbox`
ViewSets parse input, call the service, serialize the result. Services are `@transaction.atomic`.

## 5. Explicit `log_event` — NO Django signals
The audit feed (`itsm_core.AuditEvent`) is written **only** via explicit
`log_event(ticket, actor, action, payload=, field_key=)` calls at each write site
(`itsm_core/services/audit.py`). This is deliberate: greppable, and it lets us snapshot the
**previous** value in the payload (which `post_save` can't). There are **no signals** anywhere
in ITSM. If you add a write path, add the `log_event` call yourself.

## 6. Post-commit side-effects via `transaction.on_commit`
Audit logging, SLA clock ops, and notification emits are scheduled inside
`transaction.on_commit(...)` so a rolled-back write never logs/notifies. See
`ticket_service.create_ticket._after` and `engine.transition._after_commit`.

## 7. `bleach` sanitization on every rich body
Any HTML body (ticket description, comment, future canned note / email template) is run through
`sanitize_html()` on save and mirrored to a plain `*_text` field via `html_to_text()`
(`itsm_core/services/html.py`). Whitelist tags/attrs/protocols only; `@mention` spans carry
`data-type/data-id/data-label`. The frontend may then render stored markup safely.

## 8. `module_code` on every ViewSet
Every ITSM ViewSet sets a `module_code` (e.g. `itsm.tickets`) and uses
`HasModulePermission`. The base class is `apps.itsm_rbac.permissions.ItsmModelViewSet`.
HTTP method → CRUD action: GET/HEAD/OPTIONS→read, POST→create, PUT/PATCH→update, DELETE→delete.
A custom `@action` can override the module by setting `module_code` on the handler — used for
**private comments** (`itsm.tickets.comments_private`) and **bulk ops** (`itsm.tickets.bulk`).
Permissions inherit down the dot tree (closest ancestor with an explicit grant wins); superusers
bypass. See `itsm_rbac/services.check_permission`.

## 9. `select_for_update` for numbering & round-robin
Anything that hands out a sequential/shared value locks its row first:
- `numbering.generate_ticket_number` locks the per-project `TicketSequence` row.
- `groups.services.round_robin_pick` locks the per-group `GroupAssignmentState` cursor.
- `engine.transition` and `ticket_service.assign` re-fetch the ticket with `select_for_update`.
Always do this inside a transaction; never increment a shared counter without the lock.

## 10. Config snapshots on the Ticket (no stranded in-flight tickets)
`Ticket` stores `workflow` (and, when those engines land, `sla_policy`/`calendar`) chosen at
create time, so later config edits never strand open tickets. Workflows use copy-on-publish
versioning (`Workflow.version`) for the same reason.

## 11. Standard fields = first-class columns; custom = field engine
Indexed ITIL fields (status, priority, assignee, group, dates) are real columns on `Ticket`
for fast queue/SLA/reporting queries. Only the *custom* layer uses the dynamic field engine
(`itsm_core` `FieldDefinition`/`FieldValue`/`FieldLayout`) — one typed row per `(ticket, field)`.

## 12. Hooks pattern for cross-engine calls (no hard import deps)
Ticket/comment/workflow services nudge SLA + notifications through
`itsm_core/services/hooks.py`. Each hook **lazily imports** the target engine and
**no-ops if that engine isn't installed yet** (so the product works at every milestone), and
**swallows all errors** (an SLA/notification failure must never break a ticket write). When you
build an engine, expose the function the hook expects (`sla_engine.start_trackers`,
`bus.emit`, …) rather than importing the engine directly from the caller.

## 13. Idempotent, order-sensitive seeding
`python manage.py seed_itsm` runs per-app `seed.run()` (or `registry.seed_rbac()`) in
dependency order and **skips any not-yet-implemented step**. Every seed uses
`get_or_create` / `update_or_create` and is safe to re-run. Order: RBAC → helpdesks →
workflows → SLA → notifications → groups (per-helpdesk service desk) → ticket-types/projects
(per-helpdesk ITINC/ITREQ/HRINC/HRREQ) → templates → email → helpdesk memberships.

## 14. DRF conventions
- Read vs write serializers split by `get_serializer_class` where they differ
  (`ProjectSerializer`/`ProjectWriteSerializer`, ticket list/detail/create).
- `filterset_fields` + `search_fields` + `ordering_fields` declared on the ViewSet.
- After any role/permission edit, call `invalidate_permission_cache()` (clears the 5-min
  permission cache).

## 15. Helpdesk row-level scoping lives in the SHARED services
Every **ticket-facing read is clamped to the requester's helpdesk memberships** — and the clamp
lives in the *shared* query layers, **not only** `TicketViewSet.get_queryset`, because saved
filters, widgets, reports, SLA trackers and bulk-by-filter all bypass that get_queryset.
- The single source of the scope is `itsm_helpdesks.services.accessible_helpdesk_ids(user)`:
  it returns **`None` for superusers** (sentinel = *unrestricted*, do **not** filter), else the ids
  of active helpdesks the user is an active member of. Treat `None` and `[]` differently — `[]`
  means "see nothing", `None` means "see everything". `accessible_helpdesk_ids_cached(request)`
  memoizes it per request.
- Thread that id list into the shared primitives rather than re-implementing the filter:
  `query_builder.build_q(..., accessible_helpdesk_ids=)` / `filtered_tickets(...)` AND a
  `project__helpdesk_id__in`; `itsm_reporting.services.reports._base` + `sla_compliance` and
  `widget_data` take `helpdesk_ids`; `TicketViewSet._bulk` (ids branch), `SLATrackerViewSet`
  (`ticket__project__helpdesk_id__in`) apply the same clamp; and object-level writes
  (ticket `create`, `links`, `apply_template`, comment `@mention` ids) **reject** an inaccessible
  project/target/template/member with **403/404** — never silently widen.
- The `?helpdesk=<id|key>` query param is **advisory only**: pass it through
  `resolve_helpdesk_scope(user, requested)`, which *intersects* it with the accessible set. It can
  **narrow** the view but **never widens** it and **never 403s** — an out-of-scope `?helpdesk`
  just yields that user's normal (possibly empty) scope. New ticket-facing query paths MUST go
  through these helpers; do not add a bare `project__helpdesk_id` filter off an unvalidated param.
