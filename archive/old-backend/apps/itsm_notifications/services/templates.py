"""Render email templates over a whitelisted, flat ticket context (no ORM
instances in templates — prevents data leakage and lazy-load surprises)."""

from __future__ import annotations

from django.conf import settings
from django.template import Context, Template


def build_context(ticket, actor=None, context=None) -> dict:
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
            "url": f"{base}/tickets/{ticket.ticket_number}",
        },
        "actor": getattr(actor, "full_name", "") or getattr(actor, "username", "") if actor else "System",
        "event": (context or {}).get("event_label", ""),
        "extra": context or {},
    }


def render(template, ticket, actor=None, context=None, event_type=""):
    ctx = Context(build_context(ticket, actor, context))
    if template:
        subject = Template(template.subject_template).render(ctx)
        html = Template(template.body_html_template).render(ctx) if template.body_html_template else ""
        text = Template(template.body_text_template).render(ctx) if template.body_text_template else ""
    else:
        subject = f"[{ticket.ticket_number}] {event_type}: {ticket.summary}"
        text = f"{event_type} on {ticket.ticket_number} — {ticket.summary}\n{build_context(ticket)['ticket']['url']}"
        html = ""
    if not text and html:
        from apps.itsm_core.services.html import html_to_text
        text = html_to_text(html)
    return subject, html, text


def inapp_title(event_type, ticket) -> str:
    labels = {
        "TicketCreated": "created", "Assigned": "assigned to you", "StatusChanged": "status changed",
        "CommentAdded": "new comment", "CommentAddedPrivate": "internal note",
        "Mentioned": "mentioned you", "Resolved": "resolved", "Closed": "closed",
        "SLAWarning": "SLA warning", "SLABreach": "SLA breached", "TicketUpdated": "updated",
    }
    return f"{ticket.ticket_number} — {labels.get(event_type, event_type)}"
