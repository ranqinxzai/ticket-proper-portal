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

# German "Am … schrieb …:" attribution (the name follows "schrieb", so the line
# ends in "name:") — kept as its own single-line marker.
_ATTR_GERMAN = re.compile(r"^\s*Am\b.*\bschrieb\b.*:\s*$", re.IGNORECASE)
# English/French/Spanish/Italian attribution START. The "… wrote:" part is often
# WRAPPED onto the next line(s) by Gmail mobile, so we don't anchor it here.
_ATTR_WRAP_START = re.compile(r"^\s*(On|Le|El|Il)\b", re.IGNORECASE)
_ATTR_WRAP_END = re.compile(r"\b(wrote|a écrit|escribió|ha scritto)\s*:\s*$", re.IGNORECASE)

_QUOTE_MARKERS = [
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^_{10,}\s*$"),
    re.compile(r"^\s*(From|Von|De|Sent|Gesendet|To|An|Subject|Betreff):\s", re.IGNORECASE),
]
_SIGNATURE_RE = re.compile(r"^--\s?$")


def _is_attribution_start(lines, i) -> bool:
    """Is line ``i`` the start of a reply attribution ("On … wrote:")?

    Handles both the single-line form and the Gmail-mobile WRAPPED form where
    "wrote:" lands on a following line:
        On Thu, 25 Jun 2026, 10:36 pm Alice <a@x>
        wrote:
    We only cut when the attribution actually terminates in "wrote:/a écrit:/…"
    within a few lines, so a normal sentence beginning "On Monday…" is safe.
    """
    if _ATTR_GERMAN.match(lines[i]):
        return True
    if not _ATTR_WRAP_START.match(lines[i]):
        return False
    for k in (1, 2, 3):
        joined = " ".join(part.strip() for part in lines[i:i + k]).rstrip()
        if _ATTR_WRAP_END.search(joined):
            return True
    return False


def strip_quotes(text: str) -> str:
    """Cut the first quoted‑reply / forwarded block and trailing signature.
    Never returns empty if the input was non‑empty (keeps the original then)."""
    if not text:
        return text
    lines = text.splitlines()
    cut = len(lines)

    for i, line in enumerate(lines):
        if _is_attribution_start(lines, i):
            cut = i
            break
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
