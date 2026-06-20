from __future__ import annotations


def log_event(ticket, actor, action, payload=None, field_key=""):
    """Append one row to a ticket's audit feed. The single sanctioned write site."""
    from apps.itsm_core.models import AuditEvent

    return AuditEvent.objects.create(
        ticket=ticket,
        actor=actor if (actor and getattr(actor, "pk", None)) else None,
        action=action,
        field_key=field_key or "",
        payload=payload or {},
    )
