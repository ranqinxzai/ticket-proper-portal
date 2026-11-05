"""Render email templates over a whitelisted, flat ticket context (no ORM
instances in templates — prevents data leakage and lazy-load surprises), then
wrap the per-event body in the branded HTML shell (services/email_layout.py)."""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import connection
from django.template import Context, Template

from . import email_layout

logger = logging.getLogger("itsm")


def _org_slug() -> str:
    """The tenant schema doubles as the URL slug (``/t/<slug>/…``). Notifications
    emit inside the tenant request/job context, so the live connection's schema is
    the org. Empty (public/no tenant) degrades to a still-parseable path."""
    return getattr(connection, "schema_name", "") or ""


def _is_agent_recipient(ticket, recipient, cache: dict | None = None) -> bool:
    """Where should this recipient land — agent console or portal?

    The requestor is the end-user (portal). Anyone else lands in the agent console
    only when they actually work the ticket's helpdesk (superuser or helpdesk
    member); a requestor-added colleague or an approver from outside the helpdesk
    gets the portal link, which they can open read-only. A null recipient (e.g.
    the generic preview) defaults to agent."""
    if recipient is None:
        return True
    if getattr(recipient, "id", None) == ticket.requestor_id:
        return False
    from .recipients import is_helpdesk_agent
    return is_helpdesk_agent(recipient, ticket, cache)


def build_ticket_path(ticket, recipient=None, cache: dict | None = None) -> str:
    """Role-aware, tenant-correct in-app path to the ticket. Agents land in the
    project workspace; everyone else lands in the self-service portal."""
    org = _org_slug()
    num = ticket.ticket_number
    if _is_agent_recipient(ticket, recipient, cache):
        return f"/t/{org}/agent/w/{ticket.project.helpdesk.key}/p/{ticket.project.key}/{num}"
    return f"/t/{org}/portal/requests/{num}"


def build_approvals_path(ticket, recipient=None, cache: dict | None = None) -> str:
    """The approver's inbox: the agent app's for helpdesk agents, else the portal's
    (open to every signed-in user)."""
    org = _org_slug()
    if _is_agent_recipient(ticket, recipient, cache):
        return f"/t/{org}/agent/approvals"
    return f"/t/{org}/portal/approvals"


def build_link(event_type, ticket, recipient=None, cache: dict | None = None) -> str:
    """The in-app / CTA destination for one recipient of one event."""
    if event_type == "ApprovalRequested":
        return build_approvals_path(ticket, recipient, cache)
    return build_ticket_path(ticket, recipient, cache)


def _user_name(user) -> str:
    if user is None:
        return ""
    return getattr(user, "full_name", "") or getattr(user, "username", "") or ""


def approval_context(ticket, context=None) -> dict:
    """Flat facts about the approval an event is about: ``{status, workflow, stage,
    reason, decided_by}``. Uses ``context["approval_request"]`` when given; for a
    ticket sitting in the ``rejected`` status (WS1 auto-moves rejected requests
    there) it falls back to the latest non-cancelled request so the status email
    can quote the rejection reason. Empty dict when there's nothing to say."""
    try:
        from apps.itsm_approvals.models import ApprovalRequest, ApprovalStage
    except ImportError:
        return {}
    try:
        ctx = context or {}
        qs = ApprovalRequest.objects.filter(ticket=ticket, is_deleted=False)
        req = None
        if ctx.get("approval_request"):
            req = qs.filter(pk=ctx["approval_request"]).select_related("workflow", "requested_by").first()
        elif ticket.status_id and getattr(ticket.status, "key", "") == "rejected":
            req = (qs.exclude(status="cancelled").order_by("-created_at")
                   .select_related("workflow").first())
        if req is None:
            return {}
        sent = getattr(req, "source", "") == "sent"
        stage = None
        if ctx.get("stage"):
            stage = ApprovalStage.objects.filter(pk=ctx["stage"]).first()
        stage = stage or req.current_stage
        actions = req.actions.select_related("approver").order_by("-created_at")
        rejected = actions.filter(decision="rejected").first()
        last = actions.first()
        reason = (rejected.comment or "").strip() if rejected else ""
        decided_by = _user_name(last.approver) if last else ""
        return {
            "status": req.status,
            "workflow": req.workflow.name if req.workflow_id else "",
            "stage": stage.name if stage else "",
            "reason": reason,
            # Never-blank variants for templates (stored bodies avoid {% if %} —
            # the rich-text editor would mangle the tag quotes).
            "reason_text": reason or "No reason was given.",
            "decided_by": decided_by or "an approver",
            # Send for approval: the sender and their message to the approver.
            "note": (getattr(req, "note", "") or "").strip(),
            "requested_by": _user_name(req.requested_by) if sent and req.requested_by_id else "",
        }
    except Exception:  # noqa: BLE001 — context must never break an emit
        logger.exception("approval_context failed for ticket %s", getattr(ticket, "id", None))
        return {}


def build_context(ticket, actor=None, context=None, recipient=None, cache: dict | None = None) -> dict:
    base = getattr(settings, "FRONTEND_BASE_URL", "")
    requestor = ticket.requestor if ticket.requestor_id else None
    return {
        "ticket": {
            "number": ticket.ticket_number,
            "summary": ticket.summary,
            "status": ticket.status.name if ticket.status_id else "",
            "status_key": ticket.status.key if ticket.status_id else "",
            "priority": ticket.priority,
            "assignee": getattr(ticket.assignee, "full_name", "") or getattr(ticket.assignee, "username", "")
            if ticket.assignee_id else "Unassigned",
            "group": ticket.assigned_group.name if ticket.assigned_group_id else "",
            "requester": (requestor.full_name or requestor.email or requestor.username) if requestor else "",
            "requester_email": requestor.email if requestor else "",
            "url": f"{base}{build_ticket_path(ticket, recipient, cache)}",
        },
        "actor": getattr(actor, "full_name", "") or getattr(actor, "username", "") if actor else "System",
        "event": (context or {}).get("event_label", ""),
        "approval": approval_context(ticket, context),
        "approvals_url": f"{base}{build_approvals_path(ticket, recipient, cache)}",
        "extra": context or {},
    }


def render(template, ticket, actor=None, context=None, event_type="", recipient=None,
           cache: dict | None = None):
    ctx_data = build_context(ticket, actor, context, recipient, cache)
    ctx = Context(ctx_data)
    if template:
        subject = Template(template.subject_template).render(ctx)
        inner_html = Template(template.body_html_template).render(ctx) if template.body_html_template else ""
        text = Template(template.body_text_template).render(ctx) if template.body_text_template else ""
    else:
        subject = f"[{ticket.ticket_number}] {event_type}: {ticket.summary}"
        text = f"{event_type} on {ticket.ticket_number} — {ticket.summary}\n{ctx_data['ticket']['url']}"
        inner_html = f"<p>{event_type} on <strong>{ticket.ticket_number}</strong> — {ticket.summary}</p>"

    # An approval request's button goes to the approver's inbox, not the ticket.
    cta_url = cta_label = None
    if event_type == "ApprovalRequested":
        cta_url, cta_label = ctx_data["approvals_url"], "Review approval"

    # Wrap the per-event body in the branded shell (header / details card / CTA).
    html = (email_layout.wrap(event_type, inner_html, ctx_data,
                              is_agent=_is_agent_recipient(ticket, recipient, cache),
                              cta_url=cta_url, cta_label=cta_label)
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
        "ApprovalRequested": "approval needed", "ApprovalGranted": "approved",
        "ApprovalRejected": "request rejected", "ApprovalCancelled": "approval cancelled",
        "WatcherAdded": "you were added as a watcher",
    }
    label = labels.get(event_type, event_type)
    if event_type == "StatusChanged" and ticket.status_id and getattr(ticket.status, "key", "") == "rejected":
        label = "request rejected"
    return f"{ticket.ticket_number} — {label}"
