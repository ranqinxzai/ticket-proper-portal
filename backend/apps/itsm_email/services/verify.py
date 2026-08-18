"""Auto-detected outbound send capability.

A mailbox (``EmailChannel``) or a helpdesk custom transport (``HelpdeskEmailTransport``)
sends notifications only while it actually *can* send. This module classifies send
outcomes and persists the verdict on the object:

  - a **permanent** failure (bad auth, missing/insufficient OAuth scope, M365 SMTP AUTH
    disabled, sender-not-owned) flips the ``*_verified`` flag to ``False`` → the outbox
    reroutes to the workspace/system transport;
  - a **transient** failure (timeout, connection reset, greylisting/4xx, server
    disconnect) is ignored — never reroute a healthy sender over a blip;
  - an **unknown** error is treated as transient (fail-safe);
  - a per-recipient reject (``SMTPRecipientsRefused``) is a bad address, never a
    mailbox-health signal.

Shared by the outbox self-heal (``record_send_result``) and the scheduled re-verify
sweep / explicit test action (``reverify``). Field names differ per model, so a small
map bridges them; the classification and probe are identical.
"""

from __future__ import annotations

import logging
import smtplib

from django.utils import timezone

from . import mailbox, oauth

logger = logging.getLogger("itsm")

# 5xx SMTP codes that mean "this sender can't submit here" (auth/policy/sender-not-owned),
# as opposed to a transient 4xx or a per-recipient 550.
_PERMANENT_SMTP_CODES = {530, 535, 550, 553}

# kind → (Model, (verified_field, verified_at_field, verify_error_field))
_FIELDS = {
    "channel": ("outbound_send_verified", "outbound_verified_at", "outbound_verify_error"),
    "transport": ("send_verified", "verified_at", "verify_error"),
}


def is_permanent(exc) -> bool:
    """True ⇒ a confirmed permanent send failure (flip the sender off); False ⇒ transient
    or unknown (leave the sender alone)."""
    if isinstance(exc, oauth.OAuthError):
        return True
    if isinstance(exc, (smtplib.SMTPAuthenticationError, smtplib.SMTPNotSupportedError)):
        return True
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return False  # bad recipient — not a sender-health signal
    code = getattr(exc, "smtp_code", None)
    if isinstance(code, int) and code in _PERMANENT_SMTP_CODES:
        return True
    # XOAuth2EmailBackend raises SMTPException("XOAUTH2 authentication failed: 535 …").
    if isinstance(exc, smtplib.SMTPException) and "authentication failed" in str(exc).lower():
        return True
    return False  # timeouts, resets, disconnects, 4xx, and anything unrecognised → transient


def _load(kind: str, obj_id):
    from ..models import EmailChannel, HelpdeskEmailTransport

    model = {"channel": EmailChannel, "transport": HelpdeskEmailTransport}.get(kind)
    if model is None:
        return None, None
    return model.objects.filter(pk=obj_id).first(), _FIELDS[kind]


def _persist(obj, fields, *, ok: bool, detail: str):
    vf, af, ef = fields
    obj_val = getattr(obj, vf)
    if obj_val is ok and not detail:
        return  # no-op write avoidance on the hot path
    setattr(obj, vf, ok)
    setattr(obj, af, timezone.now())
    setattr(obj, ef, detail[:500] if detail else "")
    obj.save(update_fields=[vf, af, ef, "updated_at"])


def record_send_result(kind: str, obj_id, error) -> None:
    """Called by the outbox after a send. ``error`` is ``None`` on success, else the
    exception. Only PERMANENT failures flip the sender off; transient failures are ignored."""
    obj, fields = _load(kind, obj_id)
    if obj is None:
        return
    if error is None:
        return  # success path stays cheap — positive proof comes from probe/sweep
    if is_permanent(error):
        _persist(obj, fields, ok=False, detail=str(error))
        logger.warning("send capability OFF for %s %s: %s", kind, obj_id, str(error)[:200])


def reverify(kind: str, obj) -> dict:
    """Open (don't send) the transport and persist the verdict. Used by the scheduled
    sweep and the explicit test action. Returns ``{"ok", "detail"}``."""
    res = mailbox.test_smtp(obj, timeout=10)
    _persist(obj, _FIELDS[kind], ok=bool(res["ok"]), detail="" if res["ok"] else str(res.get("detail", "")))
    return res


def reverify_all() -> int:
    """Re-probe every active outbound sender in the CURRENT schema (mailboxes +
    custom helpdesk transports) and persist each verdict. Wrapped in
    ``for_each_tenant`` by the scheduler so it runs once per org. Returns the count."""
    from ..models import EmailChannel, HelpdeskEmailTransport, TransportMode

    n = 0
    for ch in EmailChannel.objects.filter(is_deleted=False, is_active=True, outbound_enabled=True):
        try:
            reverify("channel", ch)
            n += 1
        except Exception:  # noqa: BLE001 — one sender must not abort the sweep
            logger.exception("reverify channel %s failed", ch.id)
    transports = HelpdeskEmailTransport.objects.filter(
        is_deleted=False, mode=TransportMode.CUSTOM, outbound_enabled=True
    )
    for t in transports:
        try:
            reverify("transport", t)
            n += 1
        except Exception:  # noqa: BLE001
            logger.exception("reverify transport %s failed", t.id)
    return n
