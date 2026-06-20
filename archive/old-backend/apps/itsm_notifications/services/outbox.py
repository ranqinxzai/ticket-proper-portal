"""Durable email delivery — claim queued rows, send, retry with backoff."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks

logger = logging.getLogger("itsm")

_BACKOFF = [1, 5, 15, 60, 240]  # minutes


def _backoff_minutes(attempts: int) -> int:
    return _BACKOFF[min(attempts, len(_BACKOFF) - 1)]


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
        try:
            if recipient_email:
                from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None)
                # Optional threading enrichment from the email channel. None when
                # itsm_email isn't installed / no channel → behaves like send_mail.
                extra = None
                if row.ticket_id:
                    extra = hooks.email_thread_headers(
                        row.ticket, recipient_email,
                        outbox_id=str(row.id), subject=row.rendered_subject,
                    )
                headers = (extra or {}).get("headers") or {}
                reply_to = (extra or {}).get("reply_to") or None
                msg = EmailMultiAlternatives(
                    subject=row.rendered_subject,
                    body=row.rendered_body,
                    from_email=from_email,
                    to=[recipient_email],
                    reply_to=reply_to,
                    headers=headers,
                )
                msg.send(fail_silently=False)
            row.status = "sent"
            row.sent_at = timezone.now()
            row.save(update_fields=["status", "sent_at", "updated_at"])
            sent += 1
        except Exception as exc:  # noqa: BLE001
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
