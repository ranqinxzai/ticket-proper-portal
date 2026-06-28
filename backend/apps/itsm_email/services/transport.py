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
    from ..models import EmailChannel

    return (EmailChannel.objects
            .filter(project=ticket.project, is_active=True, outbound_enabled=True)
            .order_by("created_at").first())


def _connection_for(channel):
    """Build (don't open) a Django email connection for the channel, or None."""
    if channel.is_oauth:
        token = oauth.ensure_fresh(channel)  # may raise OAuthError → caller falls back
        host, port = oauth.smtp_endpoint(channel)
        return get_connection(
            backend=_XOAUTH2_BACKEND, host=host, port=port,
            use_tls=True, use_ssl=False, fail_silently=False,
            oauth_user=channel.effective_smtp_username or channel.address,
            oauth_token=token,
        )
    if not channel.smtp_host:
        return None
    sec = channel.smtp_security
    return get_connection(
        backend=_SMTP_BACKEND, host=channel.smtp_host, port=channel.smtp_port,
        username=channel.effective_smtp_username, password=channel.effective_smtp_password,
        use_tls=(sec == "starttls"), use_ssl=(sec == "ssl"), fail_silently=False,
    )


def get_outbound_config(ticket):
    """Return ``{"connection", "from_email"}`` for the ticket's mailbox, or None."""
    channel = _channel_for_ticket(ticket)
    if channel is None:
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
    return {"connection": connection, "from_email": channel.from_header}
