"""Durable email delivery — claim queued rows, send, retry with backoff."""

from __future__ import annotations

import logging
from datetime import timedelta
from email.utils import formataddr

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks

logger = logging.getLogger("itsm")

_BACKOFF = [1, 5, 15, 60, 240]  # minutes


def _backoff_minutes(attempts: int) -> int:
    return _BACKOFF[min(attempts, len(_BACKOFF) - 1)]


def _helpdesk_of(ticket):
    """The ticket's helpdesk, or None. Never raises — a config-read error must never
    break delivery."""
    try:
        return ticket.project.helpdesk
    except Exception:  # noqa: BLE001
        return None


def _system_default_from(hd):
    """(from_email, reply_to) for the platform/system SMTP tier.

    Default mode: the helpdesk's From name is shown over ``PLATFORM_NOTIFY_FROM`` (a
    domain the platform SMTP is authorised for → SPF/DKIM aligned), with Reply-To set
    to the org's own address so replies still reach them. ``hd is None`` (e.g. the
    ticket was deleted) degrades to the bare platform default with no Reply-To."""
    platform = (getattr(settings, "PLATFORM_NOTIFY_FROM", None)
                or getattr(settings, "DEFAULT_FROM_EMAIL", None))
    if hd is None:
        return platform, None
    name = hd.notification_from_name or hd.name
    from_email = formataddr((name, platform)) if platform else platform
    reply_to = [hd.notification_from_email] if hd.notification_from_email else None
    return from_email, reply_to


def _resolve_delivery(row, recipient_email):
    """Pick (connection, from_email, reply_to, headers, verify_ref) for one row.

    Precedence:
      1. Project **mailbox** (``EmailChannel``) — fail-open on its send-capability flag;
         sends FROM support@ and threads (Reply-To = the mailbox address).
      2. Helpdesk **custom** transport (``HelpdeskEmailTransport`` mode=custom).
      3. **Platform/system** SMTP — helpdesk From name over ``PLATFORM_NOTIFY_FROM``,
         Reply-To = the org address.
    ``verify_ref`` is ``("channel"|"transport", id)`` for tiers 1/2 (so a permanent send
    failure self-heals that sender), else ``None``."""
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None)
    headers, reply_to, connection, verify_ref = {}, None, None, None

    if not row.ticket_id:
        return connection, from_email, reply_to, headers, verify_ref

    extra = hooks.email_thread_headers(
        row.ticket, recipient_email, outbox_id=str(row.id), subject=row.rendered_subject,
    )
    headers = (extra or {}).get("headers") or {}

    mailbox = hooks.email_outbound_transport(row.ticket)
    if mailbox and mailbox.get("connection"):
        return (mailbox["connection"], mailbox.get("from_email") or from_email,
                (extra or {}).get("reply_to") or None, headers,
                ("channel", mailbox.get("channel_id")))

    custom = hooks.email_helpdesk_transport(row.ticket)
    if custom and custom.get("connection"):
        return (custom["connection"], custom.get("from_email") or from_email,
                custom.get("reply_to") or None, headers,
                ("transport", custom.get("transport_id")))

    from_email, reply_to = _system_default_from(_helpdesk_of(row.ticket))
    return connection, from_email, reply_to, headers, verify_ref


def flush(batch_size: int = 100):
    """Send a batch of queued/retryable email rows. Returns a summary dict."""
    from ..models import NotificationOutbox

    now = timezone.now()
    max_attempts = getattr(settings, "NOTIFICATIONS_MAX_ATTEMPTS", 6)
    sent = failed = 0

    with transaction.atomic():
        rows = list(
            NotificationOutbox.objects.select_for_update(skip_locked=True)
            .filter(status="queued")
            .filter(models_q(now))[:batch_size]
        )
        ids = [r.id for r in rows]
        NotificationOutbox.objects.filter(id__in=ids).update(status="sending")

    for row in rows:
        recipient_email = getattr(row.recipient, "email", "")
        verify_ref = None
        try:
            if recipient_email:
                connection, from_email, reply_to, headers, verify_ref = _resolve_delivery(
                    row, recipient_email
                )
                msg = EmailMultiAlternatives(
                    subject=row.rendered_subject,
                    body=row.rendered_body,
                    from_email=from_email,
                    to=[recipient_email],
                    reply_to=reply_to,
                    headers=headers,
                    connection=connection,
                )
                if row.rendered_html:
                    msg.attach_alternative(row.rendered_html, "text/html")
                msg.send(fail_silently=False)
            row.status = "sent"
            row.sent_at = timezone.now()
            row.save(update_fields=["status", "sent_at", "updated_at"])
            sent += 1
        except Exception as exc:  # noqa: BLE001
            # Self-heal: a confirmed PERMANENT failure on a mailbox/custom transport flips
            # its send-capability off so the NEXT send reroutes to the fallback tier.
            if verify_ref is not None:
                hooks.email_record_send_result(verify_ref, exc)
            row.attempts += 1
            row.last_error = str(exc)[:500]
            if row.attempts >= max_attempts:
                row.status = "dead"
            else:
                row.status = "queued"
                row.next_attempt_at = timezone.now() + timedelta(minutes=_backoff_minutes(row.attempts))
            row.save(update_fields=["attempts", "last_error", "status", "next_attempt_at", "updated_at"])
            failed += 1
            logger.warning("outbox send failed (%s): %s", row.id, exc)

    return {"sent": sent, "failed": failed}


def models_q(now):
    from django.db.models import Q
    return Q(next_attempt_at__isnull=True) | Q(next_attempt_at__lte=now)


def reap(stuck_minutes: int = 15):
    """Reset rows stuck in 'sending' (process died mid-flush) back to queued."""
    from ..models import NotificationOutbox
    cutoff = timezone.now() - timedelta(minutes=stuck_minutes)
    return NotificationOutbox.objects.filter(status="sending", updated_at__lte=cutoff).update(
        status="queued"
    )
