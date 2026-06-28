"""Threading — decide new‑vs‑reply on the way in, and build RFC headers on the
way out so a customer's reply reliably lands on the right ticket.

Inbound signals, scanned subject‑first (Jira‑style, per product decision
2026‑06‑28):
  1. subject token — [INC-123] in the subject (scanned FIRST; ungated — an
     explicit ticket number in the subject is trusted; see BUG_LOG SECURITY note)
  2. header map    — In‑Reply‑To / References matched against EmailThreadMessage
     (reached only when the subject carried no usable ticket number)
  3. plus‑address  — support+INC-123@domain in the To/Cc envelope (still
     ownership‑gated — forgeable and not part of the subject‑first contract)

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


def _sender_owns_ticket(ticket, parsed) -> bool:
    """Is the envelope sender allowed to thread a reply onto ``ticket``?

    Now guards the **plus‑address** token path only. A plus‑address token is
    forgeable, so we only honour it when the sender is a real participant: the
    ticket's requestor or a watcher (matched by email, case‑insensitively).
    Otherwise the mail starts a new ticket — the email is never lost, it just
    can't cross‑contaminate someone else's ticket.

    The **subject** token path is intentionally *not* gated (product decision
    2026‑06‑28 — see BUG_LOG): an explicit ``[INC‑123]`` in the subject threads
    on any match, even from a non‑participant. The header‑map path
    (In‑Reply‑To/References) is also *not* gated: it requires a Message‑ID we
    actually minted and recorded, a far higher bar than typing text, and it's
    how mail clients thread replies whose subject was edited away.
    """
    from apps.itsm_tickets.models import Watcher

    email = (getattr(parsed, "from_addr", "") or "").strip().lower()
    if not email:
        return False
    requestor = ticket.requestor
    if requestor and (getattr(requestor, "email", "") or "").strip().lower() == email:
        return True
    return Watcher.objects.filter(ticket=ticket, user__email__iexact=email).exists()


def resolve_thread(channel, parsed):
    """Return ('new', None) or ('reply', ticket).

    Order (subject‑first, per product decision 2026‑06‑28):
      1. SUBJECT ticket number [KEY-N] — if it resolves to a live ticket, thread
         the reply onto it and DO NOT scan headers. No ownership gate: an explicit
         ticket number in the subject is trusted (see the SECURITY note in BUG_LOG).
      2. Header map — In‑Reply‑To/References matched against a Message‑ID we minted.
         Reached only when the subject carried no usable ticket number (e.g. it was
         edited away), so replies with a mangled subject still thread.
      3. Plus‑address envelope token support+KEY-N@ — still ownership‑gated
         (forgeable and not part of the subject‑first contract).
      4. No match → new ticket.
    """
    from apps.itsm_tickets.models import Ticket

    from ..models import EmailThreadMessage

    key = channel.project.key

    # 1. Subject ticket number — trusted, scanned first. A miss (no token / unknown
    #    or deleted ticket) is NOT terminal: fall through to the header map below.
    if parsed.subject:
        m = _token_re(key).search(_strip_prefixes(parsed.subject))
        if m:
            ticket = Ticket.objects.filter(
                project=channel.project, ticket_number=m.group(1).upper()
            ).first()
            if ticket and not ticket.is_deleted:
                return ("reply", ticket)

    # 2. Header map — only when the subject had no usable ticket number. Trusted:
    #    matches a Message‑ID we minted + recorded (ungated).
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

    # 3. Plus‑address token in the envelope — forgeable, still gated to a real
    #    participant; else fall through to a new ticket.
    token = _plusaddr_token(parsed.to_addrs, key) or _plusaddr_token(parsed.cc_addrs, key)
    if token:
        ticket = Ticket.objects.filter(project=channel.project, ticket_number=token).first()
        if ticket and not ticket.is_deleted and _sender_owns_ticket(ticket, parsed):
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
    no channel exists (then the outbox sends a plain, un‑threaded mail).

    ``Reply-To`` is the **configured mailbox address** itself (e.g.
    ``helpdesk@acme.com``) — a reply to the notification therefore lands in the
    real inbox the poller reads. We deliberately do NOT plus‑address it
    (``mailbox+KEY-N@…``): many mail servers reject ``+`` subaddressing and bounce
    the reply, and we don't need it — reply→ticket threading rides the ``[KEY-N]``
    subject token (scanned first in ``resolve_thread``) plus the recorded
    ``Message-ID`` / ``In-Reply-To`` / ``References`` header map. (Inbound still
    accepts a plus‑address token from any client; we just stop minting one.)
    """
    from ..models import EmailThreadMessage

    channel = _channel_for_ticket(ticket)
    if channel is None:
        return None

    domain = channel.effective_domain or getattr(settings, "EMAIL_DOMAIN", "ticketing.local")
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

    reply_to = [channel.address]
    return {"headers": headers, "reply_to": reply_to}
