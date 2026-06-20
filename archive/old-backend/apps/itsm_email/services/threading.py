"""Threading — decide new‑vs‑reply on the way in, and build RFC headers on the
way out so a customer's reply reliably lands on the right ticket.

Three inbound signals, most‑robust first:
  A. header map   — In‑Reply‑To / References matched against EmailThreadMessage
  B. plus‑address — support+INC-123@domain in the To/Cc envelope
  C. subject token — [INC-123] in the subject

Outbound: ``build_outbound_headers`` mints a Message‑ID, records it, and chains
In‑Reply‑To / References from the latest prior thread message.
"""

from __future__ import annotations

import re

from django.conf import settings

_RE_PREFIX = re.compile(r"^\s*((re|aw|fwd|fw|wg)\s*:\s*)+", re.IGNORECASE)


def _strip_prefixes(subject: str) -> str:
    prev = None
    s = subject or ""
    while s != prev:
        prev = s
        s = _RE_PREFIX.sub("", s)
    return s


def _token_re(project_key: str) -> re.Pattern:
    # project.key is validated ^[A-Z][A-Z0-9]{1,9}$ → safe to embed.
    return re.compile(rf"\[\s*({re.escape(project_key)}-\d+)\s*\]", re.IGNORECASE)


def _plusaddr_token(addrs, project_key: str) -> str | None:
    rx = re.compile(rf"\+({re.escape(project_key)}-\d+)@", re.IGNORECASE)
    for addr in addrs or []:
        m = rx.search(addr or "")
        if m:
            return m.group(1).upper()
    return None


def resolve_thread(channel, parsed):
    """Return ('new', None) or ('reply', ticket)."""
    from apps.itsm_tickets.models import Ticket

    from ..models import EmailThreadMessage

    # A. header map
    candidate_ids = []
    if parsed.in_reply_to:
        candidate_ids.append(parsed.in_reply_to)
    candidate_ids.extend(parsed.references or [])
    if candidate_ids:
        tm = (EmailThreadMessage.objects
              .filter(channel=channel, message_id__in=candidate_ids)
              .select_related("ticket").order_by("-created_at").first())
        if tm and tm.ticket_id and not tm.ticket.is_deleted:
            return ("reply", tm.ticket)

    key = channel.project.key

    # B. plus‑address token in the envelope
    token = _plusaddr_token(parsed.to_addrs, key) or _plusaddr_token(parsed.cc_addrs, key)
    # C. subject token
    if not token and parsed.subject:
        m = _token_re(key).search(_strip_prefixes(parsed.subject))
        if m:
            token = m.group(1).upper()
    if token:
        ticket = Ticket.objects.filter(project=channel.project, ticket_number=token).first()
        if ticket:
            return ("reply", ticket)

    return ("new", None)


def record_message(channel, ticket, message_id, direction, comment=None):
    from ..models import EmailThreadMessage

    if not message_id:
        return None
    obj, _ = EmailThreadMessage.objects.update_or_create(
        channel=channel, message_id=message_id,
        defaults={"ticket": ticket, "direction": direction, "comment": comment},
    )
    return obj


# ── outbound ─────────────────────────────────────────────────────────────────

def _channel_for_ticket(ticket):
    from ..models import EmailChannel
    return (EmailChannel.objects.filter(project=ticket.project, is_active=True).first()
            or EmailChannel.objects.filter(is_active=True).first())


def build_outbound_headers(ticket, recipient_email, *, outbox_id=None, subject=None):
    """Return threading headers + reply_to for an outbound notification, and
    record the minted Message‑ID so the reply can be matched. Returns None when
    no channel exists (then the outbox sends a plain, un‑threaded mail)."""
    from ..models import EmailThreadMessage

    channel = _channel_for_ticket(ticket)
    if channel is None:
        return None

    domain = channel.effective_domain or getattr(settings, "EMAIL_DOMAIN", "ticketing.local")
    localpart = getattr(settings, "EMAIL_REPLY_TO_LOCALPART", "support")
    suffix = outbox_id or "0"
    message_id = f"<om-{ticket.ticket_number}-{suffix}@{domain}>"

    prior = (EmailThreadMessage.objects.filter(channel=channel, ticket=ticket)
             .exclude(message_id=message_id).order_by("-created_at"))
    prior_ids = [m.message_id for m in prior[:10]]

    headers = {"Message-ID": message_id}
    if prior_ids:
        headers["In-Reply-To"] = prior_ids[0]
        headers["References"] = " ".join(reversed(prior_ids))

    record_message(channel, ticket, message_id, "outbound")

    reply_to = [f"{localpart}+{ticket.ticket_number}@{domain}"]
    return {"headers": headers, "reply_to": reply_to}
