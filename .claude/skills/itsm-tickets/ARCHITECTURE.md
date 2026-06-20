# itsm-tickets — Architecture

## Layout
```
itsm_tickets/
  models.py                    # Ticket, TicketSequence, Watcher, TicketLink, TicketAttachment,
                               # Comment, CommentAttachment, MentionRecord
  services/
    ticket_service.py          # create_ticket / assign / add_comment
    numbering.py               # generate_ticket_number
  serializers.py               # TicketList/Detail/Create, Comment, Watcher, Link, Attachment, Audit
  views.py                     # TicketViewSet(+actions) + Comment/Watcher/Link/Attachment ViewSets
  urls.py
```

## Design decisions
- **Standard fields are real columns; custom fields are the field engine.** Status, priority,
  assignee, group, requestor, and all lifecycle timestamps live on `Ticket` so the queue, SLA
  sweeps, and reports query indexed columns. Only the *custom* layer uses `itsm_core.FieldValue`.
- **Hot-table indexing.** Composite indexes on `(project,status)`, `(assignee,status)`,
  `(assigned_group,status)`, `(project,status,priority)`, plus `priority`, `due_date`,
  `resolved_at`, `ticket_number` — tuned for queue filters and SLA breach scans.
- **Config snapshot.** `Ticket.workflow` (PROTECT) is captured at create so editing a project's
  default workflow never re-points an in-flight ticket. (`sla_policy`/`calendar` snapshots land
  with the SLA engine.)
- **Numbering under a lock.** `generate_ticket_number(project)` opens a transaction, locks the
  project's `TicketSequence` (`select_for_update`, `get_or_create`), increments, returns
  `"{key}-{n}"`. `ticket_number` is also DB-unique as a backstop.
- **Service choke-points + on_commit side-effects.** `create_ticket`/`assign`/`add_comment` are
  `@transaction.atomic`; each schedules `log_event` + engine hooks in `transaction.on_commit`, so
  audit/SLA/notifications only fire on a committed write.
- **Create routing.** `create_ticket` resolves the initial status from the project's default
  workflow, applies `resolve_group_and_assignee` when no explicit assignee was given, stamps
  `assigned_at` if assigned, then fires `TicketCreated` (+ `Assigned`) and `sla_start_for_ticket`.
- **Comment visibility gating.** The `comments` list action filters to public only unless the
  caller has `check_permission(user, "itsm.tickets.comments_private", "read")`. `add_comment`
  sanitizes the body, mirrors text, records mentions, and stamps `first_responded_at` on the first
  *public* reply (the SLA first-response signal).
- **Transition action delegates.** `TicketViewSet.transition` looks up the `Transition`, calls
  `engine.transition`, maps `TransitionError.status_code` (409/403/422) to the response, and adds
  the optional comment afterward via `ticket_service.add_comment`.
- **Read/write serializer split.** `create` → `TicketCreateSerializer` (flat UUID inputs);
  `list` → `TicketListSerializer`; everything else → `TicketDetailSerializer` (extends list).
  `select_related` is heavy on the queryset to keep the queue cheap.

## Activity feed
`GET tickets/{id}/activity/` returns the last 200 `itsm_core.AuditEvent` rows (newest first),
written by `log_event` at every service write site.
