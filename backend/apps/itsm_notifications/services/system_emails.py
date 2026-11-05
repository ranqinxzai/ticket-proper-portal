"""Org-level emails that aren't about a ticket (password reset). Rendered in the
same branded shell as notifications and delivered through the outbox."""

from __future__ import annotations

import uuid

from django.utils.html import escape

from . import email_layout
from .outbox import enqueue_system_email


def enqueue_password_reset(user, reset_url: str, valid_minutes: int):
    """Queue the "reset your password" email for ``user``. Returns the outbox row."""
    who = escape(user.username)
    inner_html = (
        f"<p>We received a request to reset the password for <strong>{who}</strong>.</p>"
        f"<p>Use the button below to choose a new password. The link works for "
        f"{valid_minutes} minutes and only once.</p>"
        "<p>If you didn't ask for this, you can ignore this email — your password "
        "won't change.</p>"
    )
    html = email_layout.wrap(
        "PasswordReset", inner_html, {"ticket": {}}, is_agent=False,
        cta_url=reset_url, cta_label="Reset password",
    )
    text = (
        f"We received a request to reset the password for {user.username}.\n"
        f"Choose a new password here (the link works for {valid_minutes} minutes, once):\n"
        f"{reset_url}\n\n"
        "If you didn't ask for this, ignore this email — your password won't change."
    )
    return enqueue_system_email(
        user, event_type="PasswordReset", subject="Reset your password",
        text=text, html=html, dedupe_key=f"pwreset|{user.pk}|{uuid.uuid4().hex}",
    )
