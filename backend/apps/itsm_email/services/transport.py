"""Pick the outbound mail transport for a ticket.

When a ticket's project has an active, outbound‑enabled mailbox with SMTP
configured, the notification outbox sends through *that* mailbox — so the
acknowledgement and agent replies leave FROM the support address and thread
back. ``get_outbound_config`` is consumed by the lazy hook
``itsm_core.services.hooks.email_outbound_transport``; returning ``None`` makes
the outbox fall back to the global ``DEFAULT_FROM_EMAIL`` backend (unchanged
behaviour).
"""

from __future__ import annotations

import logging

from django.core.mail import get_connection

from . import oauth

logger = logging.getLogger("itsm")

_XOAUTH2_BACKEND = "apps.itsm_email.services.smtp_backend.XOAuth2EmailBackend"
_SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"


def _channel_for_ticket(ticket):
    """The outbound‑enabled mailbox a ticket's ack/reply sends from.

    Resolved originating‑channel‑first (the mailbox the ticket actually came in on) so a
    routed ticket — whose ``project`` may be an allowed routing target rather than the
    channel's fallback ``project`` — still sends FROM the right address and threads back.
    Falls back to the fallback‑project match, then a channel whose whitelist
    (``allowed_project_links``) includes the project. Returns ``None`` (never a global
    default) if nothing serves it, keeping the no‑channel outbox byte‑identical.
    """
    from ..models import EmailChannel

    origin = (ticket.email_messages
              .filter(channel__is_active=True, channel__is_deleted=False,
                      channel__outbound_enabled=True)
              .select_related("channel").order_by("created_at").first())
    if origin is not None:
        return origin.channel
    base = EmailChannel.objects.filter(is_active=True, outbound_enabled=True)
    return (base.filter(project=ticket.project).order_by("created_at").first()
            or base.filter(
                allowed_project_links__project=ticket.project,
                allowed_project_links__is_deleted=False,
            ).distinct().order_by("created_at").first())


def _connection_for(channel, *, timeout=None):
    """Build (don't open) a Django email connection for the channel/transport, or None.

    ``timeout`` (seconds) bounds the socket so an on-demand verify probe can't hang a
    worker; ``None`` keeps the previous (unbounded) behaviour for the outbox send path.
    Works on any object exposing ``is_oauth``/``effective_smtp_*``/``smtp_*`` (EmailChannel
    or HelpdeskEmailTransport).
    """
    if channel.is_oauth:
        token = oauth.ensure_fresh(channel)  # may raise OAuthError → caller falls back
        host, port = oauth.smtp_endpoint(channel)
        return get_connection(
            backend=_XOAUTH2_BACKEND, host=host, port=port,
            use_tls=True, use_ssl=False, fail_silently=False, timeout=timeout,
            oauth_user=channel.effective_smtp_username or channel.address,
            oauth_token=token,
        )
    if not channel.smtp_host:
        return None
    sec = channel.smtp_security
    return get_connection(
        backend=_SMTP_BACKEND, host=channel.smtp_host, port=channel.smtp_port,
        username=channel.effective_smtp_username, password=channel.effective_smtp_password,
        use_tls=(sec == "starttls"), use_ssl=(sec == "ssl"), fail_silently=False, timeout=timeout,
    )


def get_outbound_config(ticket):
    """Return ``{"connection", "from_email", "channel_id"}`` for the ticket's mailbox, or None.

    FAIL-OPEN send-capability gate: a mailbox whose ``outbound_send_verified`` is
    explicitly ``False`` (a confirmed permanent send failure) steps aside so the outbox
    falls through to the workspace/system transport. ``None`` (never probed) and ``True``
    both keep sending FROM the mailbox — so existing mailboxes are unaffected until a real
    failure is observed.
    """
    channel = _channel_for_ticket(ticket)
    if channel is None:
        return None
    if channel.outbound_send_verified is False:
        return None
    try:
        connection = _connection_for(channel)
    except oauth.OAuthError as exc:
        logger.warning("OAuth send unavailable for channel %s: %s", channel.id, exc)
        return None
    except Exception:  # noqa: BLE001 — never break delivery; fall back to global backend
        logger.exception("could not build SMTP connection for channel %s", channel.id)
        return None
    if connection is None:
        return None
    return {"connection": connection, "from_email": channel.from_header, "channel_id": str(channel.id)}


def get_helpdesk_transport_config(ticket):
    """Return ``{"connection", "from_email", "reply_to", "transport_id"}`` for the ticket's
    helpdesk CUSTOM transport, or None. Used as the tier below the project mailbox and above
    the platform/system SMTP. Same fail-open gate as the mailbox."""
    from ..models import HelpdeskEmailTransport, TransportMode

    hd_id = getattr(getattr(ticket, "project", None), "helpdesk_id", None)
    if not hd_id:
        return None
    t = (HelpdeskEmailTransport.objects
         .filter(helpdesk_id=hd_id, mode=TransportMode.CUSTOM, is_deleted=False)
         .first())
    if t is None or not t.outbound_enabled or t.send_verified is False:
        return None
    try:
        connection = _connection_for(t)
    except oauth.OAuthError as exc:
        logger.warning("OAuth send unavailable for helpdesk transport %s: %s", t.id, exc)
        return None
    except Exception:  # noqa: BLE001 — never break delivery
        logger.exception("could not build SMTP connection for helpdesk transport %s", t.id)
        return None
    if connection is None:
        return None
    reply_to = [t.address] if t.address else None
    return {"connection": connection, "from_email": t.from_header,
            "reply_to": reply_to, "transport_id": str(t.id)}
