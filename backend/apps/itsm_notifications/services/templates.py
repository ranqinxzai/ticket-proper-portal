"""Render email templates over a whitelisted, flat ticket context (no ORM
instances in templates — prevents data leakage and lazy-load surprises), then
wrap the per-event body in the branded HTML shell (services/email_layout.py)."""

from __future__ import annotations

from django.conf import settings
from django.db import connection
from django.template import Context, Template

from . import email_layout


def _org_slug() -> str:
    """The tenant schema doubles as the URL slug (``/t/<slug>/…``). Notifications
    emit inside the tenant request/job context, so the live connection's schema is
    the org. Empty (public/no tenant) degrades to a still-parseable path."""
    return getattr(connection, "schema_name", "") or ""


def _is_agent_recipient(ticket, recipient) -> bool:
    """The requestor is the end-user (portal); every other recipient is staff
    (agent console). A null recipient (e.g. generic preview) defaults to agent."""
    return not (recipient is not None
                and getattr(recipient, "id", None) == ticket.requestor_id)


def build_ticket_path(ticket, recipient=None) -> str:
    """Role-aware, tenant-correct in-app path to the ticket. Agents land in the
    project workspace; the requestor lands in the self-service portal."""
    org = _org_slug()
    num = ticket.ticket_number
    if _is_agent_recipient(ticket, recipient):
        return f"/t/{org}/agent/w/{ticket.project.helpdesk.key}/p/{ticket.project.key}/{num}"
    return f"/t/{org}/portal/requests/{num}"


def build_context(ticket, actor=None, context=None, recipient=None) -> dict:
    base = getattr(settings, "FRONTEND_BASE_URL", "")
    return {
        "ticket": {
            "number": ticket.ticket_number,
            "summary": ticket.summary,
            "status": ticket.status.name if ticket.status_id else "",
            "priority": ticket.priority,
            "assignee": getattr(ticket.assignee, "full_name", "") or getattr(ticket.assignee, "username", "")
            if ticket.assignee_id else "Unassigned",
            "group": ticket.assigned_group.name if ticket.assigned_group_id else "",
            "url": f"{base}{build_ticket_path(ticket, recipient)}",
        },
        "actor": getattr(actor, "full_name", "") or getattr(actor, "username", "") if actor else "System",
        "event": (context or {}).get("event_label", ""),
        "extra": context or {},
    }


def render(template, ticket, actor=None, context=None, event_type="", recipient=None):
    ctx_data = build_context(ticket, actor, context, recipient)
    ctx = Context(ctx_data)
    if template:
        subject = Template(template.subject_template).render(ctx)
        inner_html = Template(template.body_html_template).render(ctx) if template.body_html_template else ""
        text = Template(template.body_text_template).render(ctx) if template.body_text_template else ""
    else:
        subject = f"[{ticket.ticket_number}] {event_type}: {ticket.summary}"
        text = f"{event_type} on {ticket.ticket_number} — {ticket.summary}\n{ctx_data['ticket']['url']}"
        inner_html = f"<p>{event_type} on <strong>{ticket.ticket_number}</strong> — {ticket.summary}</p>"

    # Wrap the per-event body in the branded shell (header / details card / CTA).
    html = (email_layout.wrap(event_type, inner_html, ctx_data,
                              is_agent=_is_agent_recipient(ticket, recipient))
            if inner_html else "")
    if not text and inner_html:
        from apps.itsm_core.services.html import html_to_text
        text = html_to_text(inner_html)
    return subject, html, text


def inapp_title(event_type, ticket) -> str:
    labels = {
        "TicketCreated": "created", "Assigned": "assigned to you", "StatusChanged": "status changed",
        "CommentAdded": "new comment", "CommentAddedPrivate": "internal note",
        "Mentioned": "mentioned you", "Resolved": "resolved", "Closed": "closed",
        "SLAWarning": "SLA warning", "SLABreach": "SLA breached", "TicketUpdated": "updated",
    }
    return f"{ticket.ticket_number} — {labels.get(event_type, event_type)}"
