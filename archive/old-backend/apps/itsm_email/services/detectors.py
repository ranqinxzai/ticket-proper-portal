"""Heuristics that protect the channel: auto‑reply/bulk detection, mail‑loop
detection, and quote/signature stripping.

The detectors are pure functions over a ``ParsedEmail`` (plus the channel for
the loop count), so they are trivially unit‑testable.
"""

from __future__ import annotations

import re
from datetime import timedelta

from django.utils import timezone

_AUTO_SUBJECT_RE = re.compile(
    r"^\s*(re:\s*|aw:\s*|fwd:\s*)*"
    r"(out of office|automatic reply|auto:\s|autoreply|auto-reply|abwesenheit|"
    r"undeliverable|delivery status notification|mail delivery failed|returned mail|"
    r"vacation|away from)",
    re.IGNORECASE,
)
_BULK_PRECEDENCE = {"bulk", "junk", "list", "auto_reply"}


def is_auto_or_bulk(parsed, channel) -> bool:
    """True for vacation responders, bounces, mailing lists, and self‑loops."""
    h = {k.lower(): (v or "") for k, v in (parsed.headers or {}).items()}

    auto_submitted = h.get("auto-submitted", "").strip().lower()
    if auto_submitted and auto_submitted != "no":
        return True
    if h.get("precedence", "").strip().lower() in _BULK_PRECEDENCE:
        return True
    for key in ("x-autoreply", "x-autorespond", "x-auto-response-suppress",
                "list-id", "list-unsubscribe"):
        if h.get(key):
            return True
    if h.get("x-spam-flag", "").strip().lower() == "yes":
        return True
    if h.get("return-path", "").strip() in ("<>", "<MAILER-DAEMON>"):
        return True
    if parsed.subject and _AUTO_SUBJECT_RE.match(parsed.subject):
        return True
    # Self‑loop: the mailbox emailing itself.
    if channel and parsed.from_addr and parsed.from_addr == (channel.address or "").strip().lower():
        return True
    return False


def is_mail_loop(parsed, channel) -> bool:
    """True if this sender has sent too many messages in the configured window."""
    from ..models import InboundEmail

    if not parsed.from_addr:
        return False
    since = timezone.now() - timedelta(minutes=channel.loop_window_min)
    n = InboundEmail.objects.filter(
        channel=channel, from_addr__iexact=parsed.from_addr, created_at__gte=since,
    ).count()
    return n >= channel.loop_max_messages


# ── quote / signature stripping ──────────────────────────────────────────────

_QUOTE_MARKERS = [
    re.compile(r"^\s*On .+ wrote:\s*$", re.IGNORECASE),
    re.compile(r"^\s*Am .+ schrieb .+:\s*$", re.IGNORECASE),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^_{10,}\s*$"),
    re.compile(r"^\s*(From|Von|De|Sent|Gesendet|To|An|Subject|Betreff):\s", re.IGNORECASE),
]
_SIGNATURE_RE = re.compile(r"^--\s?$")


def strip_quotes(text: str) -> str:
    """Cut the first quoted‑reply / forwarded block and trailing signature.
    Never returns empty if the input was non‑empty (keeps the original then)."""
    if not text:
        return text
    lines = text.splitlines()
    cut = len(lines)

    for i, line in enumerate(lines):
        if any(rx.match(line) for rx in _QUOTE_MARKERS):
            cut = i
            break
        if _SIGNATURE_RE.match(line):
            cut = i
            break
        if line.lstrip().startswith(">"):
            # start of a contiguous quoted region → cut here.
            cut = i
            break

    kept = "\n".join(lines[:cut]).rstrip()
    return kept if kept.strip() else text.rstrip()
