# itsm-core — API Contracts

itsm_core exposes **no REST endpoints** — no `urls.py`, no `views.py`. It is an
in-process library. Its artifacts surface through other modules' APIs.

## Internal service contracts (import surface)
```python
from apps.itsm_core.models import BaseModel, AuditEvent
from apps.itsm_core.services import log_event, sanitize_html, html_to_text, hooks

log_event(ticket, actor, action, payload=None, field_key="")  # -> AuditEvent
#   action is one of AuditEvent.Action values (ticket_created, status_changed, …)

sanitize_html(raw: str | None) -> str        # bleach-whitelisted HTML
html_to_text(raw: str | None) -> str         # plain-text mirror

# Cross-engine hooks (all swallow errors, no-op if engine absent):
hooks.sla_start_for_ticket(ticket)
hooks.sla_on_status_change(ticket, from_status, to_status)
hooks.sla_pause(ticket, metric);  hooks.sla_resume(ticket, metric);  hooks.sla_stop(ticket, metric)
hooks.emit_event(event_type: str, ticket, actor=None, context=None)
```

## Where core data appears in HTTP responses
- `AuditEvent` rows → `GET /api/v1/itsm/tickets/{id}/activity/` (serialized by
  `itsm_tickets.serializers.AuditEventSerializer`, module `itsm.tickets`).
- Sanitized HTML → `description_html` / `body_html` on ticket + comment payloads.

## Error codes
None raised directly by core (it has no views). Hooks never raise into callers.
