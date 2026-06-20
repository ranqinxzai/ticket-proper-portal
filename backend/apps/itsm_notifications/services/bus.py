"""Notification event bus — the single fan-out choke-point.

Called by ticket/comment/workflow/sla services (inside on_commit). Resolves the
project's scheme → matching rules → recipients → writes InAppNotification rows
(synchronously) + enqueues email NotificationOutbox rows. Never raises into the
caller; a notification failure must not break a ticket write.
"""

from __future__ import annotations

import hashlib
import logging

logger = logging.getLogger("itsm")


def _scheme_for(ticket):
    from ..models import NotificationScheme
    return (NotificationScheme.objects.filter(project=ticket.project, is_deleted=False).first()
            or NotificationScheme.objects.filter(is_default=True, is_deleted=False).first())


def _dedupe_key(event_type, ticket_id, user_id, channel) -> str:
    raw = f"{event_type}|{ticket_id}|{user_id}|{channel}"
    return hashlib.sha1(raw.encode()).hexdigest()[:32]


def emit(event_type: str, *, ticket, actor=None, context=None):
    try:
        _emit(event_type, ticket, actor, context or {})
    except Exception:  # noqa: BLE001
        logger.exception("notification emit failed for %s", event_type)


def _emit(event_type, ticket, actor, context):
    from . import recipients, templates
    from ..models import InAppNotification, NotificationOutbox

    scheme = _scheme_for(ticket)
    if scheme is None:
        return
    rules = scheme.rules.filter(event_type=event_type, is_active=True, is_deleted=False)
    actor_id = getattr(actor, "id", None)

    for rule in rules:
        users = recipients.resolve(rule, ticket, context)
        if not rule.notify_actor and actor_id:
            users = {u for u in users if u.id != actor_id}
        channels = rule.channels or ["in_app"]
        link = f"/tickets/{ticket.ticket_number}"

        for user in users:
            if "in_app" in channels:
                InAppNotification.objects.create(
                    recipient=user, event_type=event_type, ticket=ticket, actor=actor,
                    title=templates.inapp_title(event_type, ticket),
                    body_text=ticket.summary, link=link,
                )
            if "email" in channels and getattr(user, "email", ""):
                subject, _html, text = templates.render(
                    rule.email_template, ticket, actor, context, event_type
                )
                key = _dedupe_key(event_type, ticket.id, user.id, "email")
                NotificationOutbox.objects.get_or_create(
                    dedupe_key=key,
                    defaults={"event_type": event_type, "ticket": ticket, "recipient": user,
                              "channel": "email", "rendered_subject": subject,
                              "rendered_body": text, "status": "queued"},
                )
