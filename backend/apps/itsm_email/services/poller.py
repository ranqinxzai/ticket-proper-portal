"""Polling orchestration — fetch new mail per channel and retry failed rows.

Driven by the APScheduler jobs (``email.poll_inbound`` / ``email.retry_failed_inbound``)
and by the ``poll_email_once`` management command (manual / tests).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from . import inbound, mailbox, parser

logger = logging.getLogger("itsm")


def _is_due(channel) -> bool:
    interval = channel.poll_interval_seconds or getattr(settings, "EMAIL_POLL_INTERVAL_SECONDS", 60)
    if channel.last_polled_at is None:
        return True
    return timezone.now() >= channel.last_polled_at + timedelta(seconds=interval)


def poll_channel(channel) -> dict:
    """Fetch + process new messages for one channel. Returns a summary dict.

    Only mail that arrived at/after ``channel.connected_at`` is ingested. Older
    mail is skipped inside ``mailbox.fetch_new`` before it's downloaded, so it
    never reaches the DB — connecting (or re-pointing) a busy mailbox can't
    back-fill its history."""
    from ..models import EmailChannel

    processed = failed = skipped = 0
    started_floor = channel.connected_at
    top_uid = None
    try:
        for uid, raw in mailbox.fetch_new(channel):
            if raw is None:  # arrived before the mailbox was connected
                skipped += 1
                top_uid = max(uid, top_uid or 0)
                continue
            parsed = parser.parse(raw)
            row = inbound.process_inbound(channel, parsed)
            if row.status == row.Status.FAILED:
                failed += 1
            else:
                processed += 1
                if uid is not None:
                    mailbox.mark_seen(channel, uid)
                    top_uid = max(uid, top_uid or 0)
        err = ""
    except Exception as exc:  # noqa: BLE001 — a bad mailbox must not kill the loop
        logger.exception("poll failed for channel %s", channel.id)
        err = str(exc)[:500]

    # fetch_new may have re-anchored the cursor (channel updated in place).
    cursor = channel.last_seen_uid
    if top_uid is not None and (cursor is None or top_uid > cursor):
        cursor = top_uid
    now = timezone.now()
    # Only move the cursor if the mailbox wasn't re-pointed while this poll ran —
    # otherwise we'd write the OLD mailbox's cursor over the fresh start.
    moved = EmailChannel.objects.filter(pk=channel.pk, connected_at=started_floor).update(
        last_polled_at=now, last_seen_uid=cursor, uid_validity=channel.uid_validity,
        connected_at=channel.connected_at, last_error=err,
    )
    if not moved:
        EmailChannel.objects.filter(pk=channel.pk).update(last_polled_at=now)
    return {"channel": channel.name, "processed": processed, "failed": failed,
            "skipped": skipped, "error": err}


def poll_active_channels() -> list[dict]:
    from ..models import EmailChannel

    results = []
    for channel in EmailChannel.objects.filter(is_active=True, is_deleted=False):
        if _is_due(channel):
            results.append(poll_channel(channel))
    return results


def retry_failed() -> dict:
    """Reprocess failed InboundEmail rows whose backoff has elapsed."""
    from ..models import InboundEmail

    now = timezone.now()
    rows = InboundEmail.objects.filter(
        status=InboundEmail.Status.FAILED, next_attempt_at__isnull=False, next_attempt_at__lte=now,
    ).select_related("channel")[:100]
    retried = recovered = 0
    for row in rows:
        retried += 1
        # Reparse is impossible (we don't keep raw bytes); replay from the stored
        # snapshot is enough to re‑run the create/comment + side‑effects.
        parsed = _reconstruct(row)
        result = inbound.process_inbound(row.channel, parsed)
        if result.status == InboundEmail.Status.PROCESSED:
            recovered += 1
    return {"retried": retried, "recovered": recovered}


def _reconstruct(row):
    """Build a minimal ParsedEmail from a stored InboundEmail row for retry."""
    p = parser.ParsedEmail(message_id=row.message_id)
    p.in_reply_to = row.in_reply_to
    p.references = row.references or []
    p.from_addr = row.from_addr
    p.from_name = row.from_name
    p.to_addrs = row.to_addrs or []
    p.cc_addrs = row.cc_addrs or []
    p.subject = row.subject
    p.date = row.date_header
    p.size_bytes = row.size_bytes
    p.headers = row.headers or {}
    p.body_text = row.body_text
    from html import escape
    p.body_html = "".join(f"<p>{escape(ln)}</p>" for ln in (row.body_text or "").splitlines() if ln.strip())
    return p
