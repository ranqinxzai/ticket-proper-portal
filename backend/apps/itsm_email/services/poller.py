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
    """Fetch + process new messages for one channel. Returns a summary dict."""
    from ..models import EmailChannel

    # First-ever poll on an IMAP mailbox: set a 'start from now' high-water mark
    # so we DON'T back-fill the entire existing inbox (a busy mailbox can hold
    # thousands of old messages). Only mail arriving AFTER connection becomes
    # tickets. POP3 already fetches only the most-recent messages, so it's exempt.
    if channel.protocol == "imap" and channel.last_seen_uid is None:
        baseline = mailbox.current_max_uid(channel)
        if baseline is not None:
            EmailChannel.objects.filter(pk=channel.pk).update(
                last_seen_uid=baseline, last_polled_at=timezone.now(), last_error="",
            )
            channel.last_seen_uid = baseline
            logger.info(
                "channel %s baselined at uid %s — %s existing messages skipped (start-from-now)",
                channel.id, baseline, baseline,
            )
            return {"channel": channel.name, "processed": 0, "failed": 0,
                    "error": "", "baseline_uid": baseline}

    processed = failed = 0
    last_uid = channel.last_seen_uid
    try:
        for uid, raw in mailbox.fetch_new(channel):
            parsed = parser.parse(raw)
            row = inbound.process_inbound(channel, parsed)
            if row.status == row.Status.FAILED:
                failed += 1
            else:
                processed += 1
                if uid is not None:
                    mailbox.mark_seen(channel, uid)
                    last_uid = uid if (last_uid is None or uid > last_uid) else last_uid
        err = ""
    except Exception as exc:  # noqa: BLE001 — a bad mailbox must not kill the loop
        logger.exception("poll failed for channel %s", channel.id)
        err = str(exc)[:500]

    EmailChannel.objects.filter(pk=channel.pk).update(
        last_polled_at=timezone.now(), last_seen_uid=last_uid, last_error=err,
    )
    return {"channel": channel.name, "processed": processed, "failed": failed, "error": err}


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
