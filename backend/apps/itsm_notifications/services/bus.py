"""Notification event bus — the single fan-out choke-point.

Called by ticket/comment/workflow/sla services (inside on_commit). Resolves the
project's scheme → matching rules → recipients → writes InAppNotification rows
(synchronously) + enqueues email NotificationOutbox rows. Never raises into the
caller; a notification failure must not break a ticket write.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta

logger = logging.getLogger("itsm")


def _scheme_for(ticket):
    from ..models import NotificationScheme
    return (NotificationScheme.objects.filter(project=ticket.project, is_deleted=False).first()
            or NotificationScheme.objects.filter(is_default=True, is_deleted=False).first())


# Context fields that identify the specific OCCURRENCE of an event (not the
# recipients). Two events of the same type on the same ticket to the same user
# — e.g. two comments, or two SLA escalations — must NOT collapse onto one
# outbox row, so the occurrence is folded into the dedupe key. Without this, a
# requestor received email for only the FIRST comment on a ticket, ever.
# `from`/`to`/`changed_at` do the same for status-change events (StatusChanged/
# Resolved/Closed): the workflow engine stamps them per transition, so each
# transition is a distinct occurrence — previously every status change on a
# ticket shared one key and only the first ever emailed. `stage` keeps a
# level-2 ApprovalRequested apart from level 1 (same request id) so an approver
# on both levels is asked twice.
_OCCURRENCE_KEYS = ("comment_id", "approval_request", "stage", "metric", "threshold",
                    "from", "to", "changed_at", "watcher_user_id")


def _context_discriminator(context) -> str:
    if not context:
        return ""
    return "|".join(
        f"{k}={context[k]}" for k in _OCCURRENCE_KEYS
        if context.get(k) not in (None, "")
    )


def _dedupe_key(event_type, ticket_id, user_id, channel, discriminator="") -> str:
    raw = f"{event_type}|{ticket_id}|{user_id}|{channel}|{discriminator}"
    return hashlib.sha1(raw.encode()).hexdigest()[:32]


def _with_approval_stage(event_type, context):
    """Approval events that don't say which stage they're about get the request's
    current stage folded in (dedupe only — see _OCCURRENCE_KEYS)."""
    if not event_type.startswith("Approval") or context.get("stage") or not context.get("approval_request"):
        return context
    try:
        from apps.itsm_approvals.models import ApprovalRequest
        stage_id = (ApprovalRequest.objects.filter(pk=context["approval_request"])
                    .values_list("current_stage_id", flat=True).first())
    except Exception:  # noqa: BLE001
        return context
    return {**context, "stage": str(stage_id)} if stage_id else context


def _is_rejected(ticket) -> bool:
    return bool(ticket.status_id and getattr(ticket.status, "key", "") == "rejected")


def _rejection_ref(event_type, ticket, context):
    """For the two ways a requestor hears about a rejected request — the
    ApprovalRejected event and the status change into ``rejected`` (WS1 auto-moves
    the ticket there) — a shared reference so each person gets ONE email, not
    two. ``None`` for every other event."""
    if event_type == "ApprovalRejected":
        return context.get("approval_request") or "reject"
    if event_type == "StatusChanged" and _is_rejected(ticket):
        try:
            from apps.itsm_approvals.models import ApprovalRequest
            req_id = (ApprovalRequest.objects.filter(ticket=ticket, is_deleted=False)
                      .exclude(status="cancelled").order_by("-created_at")
                      .values_list("id", flat=True).first())
        except Exception:  # noqa: BLE001
            req_id = None
        return str(req_id) if req_id else None
    return None


def emit(event_type: str, *, ticket, actor=None, context=None):
    try:
        _emit(event_type, ticket, actor, context or {})
    except Exception:  # noqa: BLE001
        logger.exception("notification emit failed for %s", event_type)


def _emit(event_type, ticket, actor, context):
    from django.utils import timezone

    from . import recipients, templates
    from ..models import InAppNotification, NotificationOutbox

    if getattr(ticket, "is_deleted", False):
        return  # deleted tickets are silent (same rule as hooks.emit_event)

    # A rejected request entering its done "Rejected" status is not a resolution:
    # notify it as a status change (whose template explains the rejection) instead
    # of "Good news — resolved".
    # The engine treats "rejected" as terminal and emits Closed for it.
    if event_type in ("Resolved", "Closed") and _is_rejected(ticket):
        event_type = "StatusChanged"

    scheme = _scheme_for(ticket)
    if scheme is None:
        return
    rules = scheme.rules.filter(event_type=event_type, is_active=True, is_deleted=False)
    actor_id = getattr(actor, "id", None)
    context = _with_approval_stage(event_type, context)
    # Same for every recipient of this emit — identifies THIS occurrence so
    # distinct events (e.g. successive comments) don't share a dedupe key.
    discriminator = _context_discriminator(context)
    rejection_ref = _rejection_ref(event_type, ticket, context)
    cache: dict = {}  # helpdesk-membership lookups, per user, for this emit
    # A status change INTO "Rejected" is worded with the scheme's ApprovalRejected
    # message (who rejected + the reason), not the generic "moved to X".
    rejected_tpl = None
    if event_type == "StatusChanged" and _is_rejected(ticket):
        rej_rule = scheme.rules.filter(event_type="ApprovalRejected", is_deleted=False,
                                       email_template__isnull=False).first()
        rejected_tpl = rej_rule.email_template if rej_rule else None

    for rule in rules:
        users = recipients.resolve(rule, ticket, context)
        # S3: internal events only ever reach agents on the ticket's helpdesk.
        users = recipients.restrict_audience(users, event_type, ticket, context, cache)
        if not rule.notify_actor and actor_id:
            users = {u for u in users if u.id != actor_id}
        channels = rule.channels or ["in_app"]

        for user in users:
            # Role-aware, tenant-correct deep link (agents → workspace, others → portal;
            # an approval request → the approver's inbox).
            link = templates.build_link(event_type, ticket, user, cache)
            title = templates.inapp_title(event_type, ticket)
            if "in_app" in channels:
                duplicate = rejection_ref is not None and InAppNotification.objects.filter(
                    recipient=user, ticket=ticket, title=title,
                    created_at__gte=timezone.now() - timedelta(minutes=10),
                ).exists()
                if not duplicate:
                    InAppNotification.objects.create(
                        recipient=user, event_type=event_type, ticket=ticket, actor=actor,
                        title=title, body_text=ticket.summary, link=link,
                    )
            if "email" in channels and getattr(user, "email", ""):
                subject, html, text = templates.render(
                    rejected_tpl or rule.email_template, ticket, actor, context, event_type, recipient=user,
                    cache=cache,
                )
                if rejection_ref is not None:
                    key = _dedupe_key("RequestRejected", ticket.id, user.id, "email", rejection_ref)
                else:
                    key = _dedupe_key(event_type, ticket.id, user.id, "email", discriminator)
                NotificationOutbox.objects.get_or_create(
                    dedupe_key=key,
                    defaults={"event_type": event_type, "ticket": ticket, "recipient": user,
                              "channel": "email", "rendered_subject": subject,
                              "rendered_body": text, "rendered_html": html, "status": "queued"},
                )
            if "whatsapp" in channels:
                # Groundwork only — WhatsApp delivery is not implemented yet.
                # Intentionally NO enqueue: the outbox flusher only sends email and
                # would otherwise attempt + dead-letter a whatsapp row. A rule listing
                # "whatsapp" is therefore safe today and simply produces no message.
                # TODO: enqueue NotificationOutbox(channel="whatsapp") when a WhatsApp
                # transport + per-project config land.
                pass
