"""The inbound choke‑point: turn a parsed email into a ticket or a comment.

``process_inbound(channel, parsed)`` is idempotent (keyed on Message‑ID) and
resume‑safe (re‑entry after a partial failure continues rather than duplicating
a ticket). It NEVER raises to the poll loop — every failure is captured on the
durable ``InboundEmail`` row, which is the retry + "failed requests" surface.
"""

from __future__ import annotations

import logging
import traceback
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.itsm_tickets.services import ticket_service

from . import attachments, detectors, identity, priority, threading
from .system_user import get_email_bot

logger = logging.getLogger("itsm")


def _default_ticket_type(project):
    from apps.itsm_projects.models import TicketType

    return (TicketType.objects.filter(project=project, is_default=True, is_active=True).first()
            or TicketType.objects.filter(project=project, is_active=True).order_by("sort_order").first()
            or TicketType.objects.filter(project=project).first())


def _ignore(row, reason):
    row.status = row.Status.IGNORED
    row.ignore_reason = reason
    row.processed_at = timezone.now()
    row.save(update_fields=["status", "ignore_reason", "processed_at", "updated_at"])
    return row


def _allowed_by_rules(channel, addr) -> bool:
    """Block rules win; if any active allow rule exists, sender must match one."""
    from ..models import EmailRule

    rules = list(EmailRule.objects.filter(is_active=True).filter(
        models_channel_q(channel)
    ))
    for r in rules:
        if r.rule_type == EmailRule.RuleType.BLOCK and r.matches(addr):
            return False
    allows = [r for r in rules if r.rule_type == EmailRule.RuleType.ALLOW]
    if allows:
        return any(r.matches(addr) for r in allows)
    return True


def models_channel_q(channel):
    from django.db.models import Q
    return Q(channel=channel) | Q(channel__isnull=True)


def process_inbound(channel, parsed):
    from ..models import InboundEmail

    # 1) idempotency row (unique on channel+message_id)
    row, created = InboundEmail.objects.get_or_create(
        channel=channel, message_id=parsed.message_id,
        defaults=_row_defaults(parsed),
    )
    if not created and row.status in (InboundEmail.Status.PROCESSED, InboundEmail.Status.IGNORED):
        return row  # already handled — no‑op

    try:
        with transaction.atomic():
            # Serialise concurrent processing of the SAME message (a manual
            # "poll now" racing the scheduler poll, or any future multi-worker
            # poll): lock the row, then RE-READ its status under the lock. The
            # first worker runs the pipeline and commits PROCESSED/IGNORED; the
            # second blocks here, then sees the terminal status and no-ops — so a
            # reply can never create two comments (the TOCTOU that produced the
            # duplicate on ITINC-613).
            locked = InboundEmail.objects.select_for_update().get(pk=row.pk)
            if locked.status in (InboundEmail.Status.PROCESSED, InboundEmail.Status.IGNORED):
                return locked
            return _run_pipeline(channel, parsed, locked)
    except Exception as exc:  # noqa: BLE001 — must never break the poll loop
        logger.exception("inbound processing failed for %s", parsed.message_id)
        row.refresh_from_db()
        if row.status in (InboundEmail.Status.PROCESSED, InboundEmail.Status.IGNORED):
            return row  # a concurrent worker already finished it
        row.status = InboundEmail.Status.FAILED
        row.last_error = (str(exc) + "\n" + traceback.format_exc())[:2000]
        row.attempts = (row.attempts or 0) + 1
        max_attempts = getattr(settings, "EMAIL_MAX_INBOUND_ATTEMPTS", 5)
        if row.attempts < max_attempts:
            row.next_attempt_at = timezone.now() + timedelta(minutes=10 * row.attempts)
        else:
            row.next_attempt_at = None
        row.save(update_fields=["status", "last_error", "attempts", "next_attempt_at", "updated_at"])
        return row


def _row_defaults(parsed):
    from ..models import InboundEmail

    return {
        "in_reply_to": parsed.in_reply_to or "",
        "references": parsed.references or [],
        "from_addr": parsed.from_addr or "",
        "from_name": parsed.from_name or "",
        "to_addrs": parsed.to_addrs or [],
        "cc_addrs": parsed.cc_addrs or [],
        "subject": (parsed.subject or "")[:998],
        "date_header": parsed.date,
        "size_bytes": parsed.size_bytes or 0,
        "headers": parsed.headers or {},
        "body_text": (parsed.body_text or "")[:5000],
        "status": InboundEmail.Status.RECEIVED,
    }


def _run_pipeline(channel, parsed, row):
    from ..models import InboundEmail

    addr = parsed.from_addr

    # 3) block / allow list
    if not _allowed_by_rules(channel, addr):
        return _ignore(row, "blocklist")

    # 4) auto‑reply / bulk
    if channel.ignore_auto_replies and detectors.is_auto_or_bulk(parsed, channel):
        return _ignore(row, "auto_reply")

    # 5) mail loop
    if detectors.is_mail_loop(parsed, channel):
        return _ignore(row, "loop")

    # 6) age + size caps
    if parsed.date and parsed.date < timezone.now() - timedelta(days=channel.max_age_days):
        return _ignore(row, "age")
    if parsed.size_bytes and parsed.size_bytes > channel.max_size_bytes:
        return _ignore(row, "size_cap")

    # 7) sender → user
    sender = identity.resolve_or_create_user(
        addr, parsed.from_name, create_users=channel.create_users,
        default_requestor=channel.default_requestor,
    )
    row.requestor = sender if getattr(sender, "pk", None) else None

    bot = get_email_bot()

    # 8) thread decision
    kind, ticket = threading.resolve_thread(channel, parsed)

    # 9) create vs comment — resume‑safe (skip if a prior attempt already did it)
    if row.ticket_id:
        ticket = row.ticket  # resume: ticket already created/identified

    if kind == "new" and not row.ticket_id:
        ticket = _create_ticket(channel, parsed, sender, bot)
        row.ticket = ticket
        row.action_taken = "created_ticket"
        threading.record_message(channel, ticket, parsed.message_id, "inbound")
        _attach_and_watch(channel, ticket, parsed, sender, is_new=True)
    elif kind == "reply":
        if not row.comment_id:
            _maybe_reopen(channel, ticket, bot)
            comment = _add_comment(channel, ticket, parsed, sender)
            row.ticket = ticket
            row.comment = comment
            row.action_taken = "added_comment"
            threading.record_message(channel, ticket, parsed.message_id, "inbound", comment=comment)
            _attach_and_watch(channel, comment, parsed, sender, is_new=False, ticket=ticket)

    # 13) finalize
    row.status = InboundEmail.Status.PROCESSED
    row.processed_at = timezone.now()
    row.last_error = ""
    row.next_attempt_at = None
    row.save(update_fields=[
        "ticket", "comment", "requestor", "action_taken", "status",
        "processed_at", "last_error", "next_attempt_at", "updated_at",
    ])
    return row


def _create_ticket(channel, parsed, sender, bot):
    ticket_type = _default_ticket_type(channel.project)
    summary = (parsed.subject or "").strip()[:500] or "(no subject)"
    return ticket_service.create_ticket(
        project=channel.project, ticket_type=ticket_type, summary=summary,
        description_html=parsed.body_html, requestor=sender, source="email",
        priority=priority.resolve_priority(parsed, channel),
        assigned_group=channel.default_group,
        user=bot, apply_routing=True,
    )


def _add_comment(channel, ticket, parsed, sender):
    body = parsed.body_text or ""
    if channel.strip_quotes and body:
        body = detectors.strip_quotes(body)
    # Re‑wrap the (stripped) text as simple HTML if we only have text; otherwise
    # keep the HTML body but strip quotes from its text isn't trivial → use HTML
    # as‑is when present and stripping isn't requested.
    if parsed.body_html and not channel.strip_quotes:
        body_html = parsed.body_html
    elif body:
        from html import escape
        body_html = "".join(f"<p>{escape(ln)}</p>" for ln in body.splitlines() if ln.strip()) \
            or f"<p>{escape(body)}</p>"
    else:
        body_html = parsed.body_html
    author = sender if getattr(sender, "pk", None) else get_email_bot()
    return ticket_service.add_comment(
        ticket=ticket, author=author, body_html=body_html, visibility="public",
    )


def _maybe_reopen(channel, ticket, bot):
    from ..models import ReopenPolicy

    if channel.reopen_policy != ReopenPolicy.REOPEN:
        return
    try:
        if (ticket.status.category.key != "done"):
            return
    except Exception:  # noqa: BLE001
        return
    # window check
    stamp = ticket.resolved_at or ticket.closed_at
    if stamp and stamp < timezone.now() - timedelta(days=channel.reopen_window_days):
        return
    from apps.itsm_workflows.services import engine

    try:
        for tr in engine.available_transitions(ticket, bot):
            if tr.to_status.category.key != "done":
                engine.transition(ticket, tr, user=bot)
                ticket.refresh_from_db()
                return
    except Exception:  # noqa: BLE001 — reopen is best‑effort; fall back to comment‑only
        logger.warning("reopen failed for %s; commenting only", ticket.ticket_number)


def _attach_and_watch(channel, target, parsed, sender, *, is_new, ticket=None):
    tk = ticket or target
    if parsed.attachments:
        _created, skipped = attachments.attach_parts(
            target=target, parts=parsed.attachments, uploaded_by=sender,
            html_body=parsed.body_html, max_bytes=channel.max_attachment_bytes,
        )
        if skipped:
            _note_skipped_attachments(tk, skipped, channel.max_attachment_bytes)
    if channel.cc_watchers and parsed.cc_addrs:
        _add_cc_watchers(tk, parsed.cc_addrs)


def _note_skipped_attachments(ticket, skipped, cap_bytes):
    """Leave a private agent note when an inbound attachment was too large to keep."""
    from html import escape

    cap_mb = round(cap_bytes / (1024 * 1024), 1)
    items = "".join(
        f"<li>{escape(name)} ({round(size / (1024 * 1024), 1)} MB)</li>" for name, size in skipped
    )
    body = (f"<p>{len(skipped)} attachment(s) exceeded the {cap_mb} MB limit and were not "
            f"saved:</p><ul>{items}</ul>")
    try:
        ticket_service.add_comment(
            ticket=ticket, author=get_email_bot(), body_html=body, visibility="private",
        )
    except Exception:  # noqa: BLE001 — the note is best‑effort, never fail ingestion
        logger.warning("could not record skipped-attachment note on %s", ticket.ticket_number)


def _add_cc_watchers(ticket, cc_addrs):
    from django.contrib.auth import get_user_model

    from apps.itsm_tickets.models import Watcher

    User = get_user_model()
    for addr in cc_addrs:
        user = User.objects.filter(email__iexact=addr).order_by("date_joined").first()
        if user:
            Watcher.objects.get_or_create(ticket=ticket, user=user)
