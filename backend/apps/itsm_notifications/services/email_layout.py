"""Branded HTML email shell — trusted, send-time chrome around the per-event body.

The fragile, design-heavy parts of an HTML email (table layout, inline styles,
header/footer, bulletproof button) live here in TRUSTED code, never in the
sanitized ``EmailTemplate.body_html_template`` field. The stored per-event body
is just the message (sanitiser-safe ``<p>``/``<strong>``); ``wrap`` injects it
into the ``email_base.html`` shell with a brand header, a ticket-details card and
a role-aware CTA button. This keeps the design out of reach of the rich-text
sanitiser + Tiptap editor (which would otherwise strip it), DRY across all 11
events, and consistent regardless of what a supervisor edits in the body.
"""

from __future__ import annotations

from django.template.loader import render_to_string

BRAND_NAME = "One Helpdesk"

# Accent palette mirrors the app theme (frontend globals.css): brand blue for
# routine events, green for happy-path closure, amber/red for SLA urgency.
_BLUE = "#1d4ed8"
_GREEN = "#16794a"
_AMBER = "#b45309"
_RED = "#b91c1c"

# event_type -> (accent colour, headline shown above the body)
EVENT_ACCENTS = {
    "TicketCreated": (_BLUE, "New ticket created"),
    "TicketUpdated": (_BLUE, "Ticket updated"),
    "StatusChanged": (_BLUE, "Status changed"),
    "Assigned": (_BLUE, "Assigned to you"),
    "CommentAdded": (_BLUE, "New comment"),
    "CommentAddedPrivate": (_BLUE, "Internal note added"),
    "Mentioned": (_BLUE, "You were mentioned"),
    "Resolved": (_GREEN, "Ticket resolved"),
    "Closed": (_GREEN, "Ticket closed"),
    "SurveyRequest": (_GREEN, "How did we do?"),
    "SLAWarning": (_AMBER, "SLA at risk"),
    "SLABreach": (_RED, "SLA breached"),
}
_DEFAULT_ACCENT = (_BLUE, "Ticket notification")


_PRIORITY_LABELS = {"p1": "P1 – Critical", "p2": "P2 – High",
                    "p3": "P3 – Medium", "p4": "P4 – Low"}


def _priority_label(value) -> str:
    if not value:
        return ""
    return _PRIORITY_LABELS.get(str(value).lower(), str(value).replace("_", " ").title())


def _requester_label(ticket: dict) -> str:
    """Name (email), or whichever half exists — never the same address twice."""
    name = ticket.get("requester") or ""
    email = ticket.get("requester_email") or ""
    if name and email and name.lower() != email.lower():
        return f"{name} ({email})"
    return name or email


def _preheader(ticket: dict, headline: str) -> str:
    """The hidden snippet shown next to the subject in most inboxes."""
    bits = [headline]
    if ticket.get("number"):
        bits.append(str(ticket["number"]))
    if ticket.get("summary"):
        bits.append(str(ticket["summary"]))
    return " · ".join(bits)[:140]


def wrap(event_type: str, content_html: str, ctx: dict, is_agent: bool = True,
         *, cta_url: str | None = None, cta_label: str | None = None) -> str:
    """Render the full branded HTML email around an already-rendered body fragment.

    ``ctx`` is the flat context from ``templates.build_context`` (``ctx['ticket']``
    holds number/summary/status/priority/assignee/group/requester/url). ``content_html``
    is the per-event body after Django-template substitution. ``is_agent`` picks the
    CTA wording for the recipient's destination (agent console vs portal) and adds
    the Requester row (staff need to know who raised it; the requestor knows).
    ``cta_url``/``cta_label`` override the default "View ticket/request" CTA — used
    by the CSAT survey email to point the button at the portal feedback page."""
    accent, headline = EVENT_ACCENTS.get(event_type, _DEFAULT_ACCENT)
    ticket = ctx.get("ticket", {}) or {}

    # Only show rows that actually have a value, so the card never has blanks.
    rows = [
        ("Ticket", ticket.get("number")),
        ("Requester", _requester_label(ticket) if is_agent else ""),
        ("Status", ticket.get("status")),
        ("Priority", _priority_label(ticket.get("priority"))),
        ("Assignee", ticket.get("assignee")),
        ("Group", ticket.get("group")),
    ]
    details = [(label, value) for label, value in rows if value]

    return render_to_string(
        "itsm_notifications/email_base.html",
        {
            "brand_name": BRAND_NAME,
            "accent": accent,
            "headline": headline,
            "preheader": _preheader(ticket, headline),
            "content_html": content_html,
            "details": details,
            "cta_url": cta_url if cta_url is not None else (ticket.get("url") or ""),
            "cta_label": cta_label or ("View ticket" if is_agent else "View request"),
            "ticket_number": ticket.get("number") or "",
        },
    )
