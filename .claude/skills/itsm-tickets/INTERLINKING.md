# itsm-tickets — Interlinking

## Depends on
- **itsm-core** — `BaseModel`, `log_event`, `sanitize_html`/`html_to_text`, `hooks`
  (`sla_start_for_ticket`, `emit_event`).
- **itsm-projects** — `Ticket.project`/`ticket_type` (PROTECT); numbering uses `project.key`;
  create reads `project.default_workflow`/`default_group`.
- **itsm-workflows** — `Ticket.status`/`workflow` (PROTECT); `engine.transition` +
  `available_transitions` drive the lifecycle; create resolves the initial status.
- **itsm-groups** — `Ticket.assigned_group`; `resolve_group_and_assignee` at create time;
  auto-assign during transitions.
- **itsm-rbac** — `ItsmModelViewSet` base; `check_permission` for the private-comment gate.

## Depended on by
- **itsm-core** — `AuditEvent.ticket` FK points back to `Ticket`.
- **itsm-fields** — `FieldValue.ticket`; layouts validated against the ticket's project/type.
- **itsm-sla** (planned) — `SLATracker` per ticket; reads first-class lifecycle timestamps;
  `create_ticket` calls `sla_start_for_ticket`.
- **itsm-notifications** (planned) — events (`TicketCreated/Assigned/CommentAdded/Mentioned/...`)
  originate from `ticket_service`; `Watcher`/`MentionRecord` feed recipient resolution.
- **itsm-reporting / itsm-dashboards** — aggregate over `Ticket` columns; `query_spec`→Q filters
  target ticket fields.
- **itsm-canned-notes / itsm-templates** — extend this app (snippets inserted into comments;
  templates prefill the create wizard / `apply-template`).

## Cross-engine seam
SLA + notifications are reached only via `itsm_core.hooks` (post-commit), never imported here.
