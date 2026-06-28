"""Email Channel — connect a mailbox so inbound mail becomes tickets/comments
and outbound notifications thread back.

Four models:
  - ``EmailChannel``       a configured mailbox + JSM‑style processing options.
  - ``InboundEmail``       durable per‑message log; the idempotency + retry surface.
  - ``EmailThreadMessage`` message‑id ↔ ticket map (both directions) for threading.
  - ``EmailRule``          allow/block list entries.

All inherit ``BaseModel`` (UUID PK, timestamps, soft delete). Migrations depend
upstream only (itsm_projects, itsm_tickets, itsm_groups, accounts.User).
"""

from __future__ import annotations

import fnmatch

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel
from apps.itsm_tickets.models import Priority

from .crypto import EncryptedField


class Protocol(models.TextChoices):
    IMAP = "imap", "IMAP"
    POP3 = "pop3", "POP3"


class AuthMethod(models.TextChoices):
    BASIC = "basic", "Username & password"
    OAUTH_GOOGLE = "oauth_google", "Google (OAuth2)"
    OAUTH_MICROSOFT = "oauth_microsoft", "Microsoft 365 (OAuth2)"


class ReopenPolicy(models.TextChoices):
    COMMENT_ONLY = "comment_only", "Comment only (leave closed)"
    REOPEN = "reopen", "Reopen the ticket"
    NEW_TICKET = "new_ticket", "Create a new ticket"


class SmtpSecurity(models.TextChoices):
    STARTTLS = "starttls", "STARTTLS"
    SSL = "ssl", "SSL/TLS"
    NONE = "none", "None"


def _default_priority_map() -> dict:
    """Email priority signal → ticket Priority. Admins edit this per channel.

    Keys are the (lower‑cased) values of ``X-Priority`` (leading digit 1‑5),
    ``Importance``, ``X-MSMail-Priority`` and ``Priority``; values are
    ``itsm_tickets.Priority`` choices. A signal with no key falls back to
    ``default_priority``.
    """
    return {
        "1": "critical", "2": "high", "3": "medium", "4": "low", "5": "low",
        "high": "high", "normal": "medium", "low": "low",
        "urgent": "critical", "non-urgent": "low",
    }


class EmailChannel(BaseModel):
    """A mailbox the platform polls for inbound requests."""

    name = models.CharField(max_length=150)
    project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.PROTECT, related_name="email_channels"
    )
    address = models.EmailField(help_text="The catch address, e.g. support@company.com")
    domain = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Host used in Message‑ID / plus‑addressed Reply‑To (defaults to the address domain).",
    )
    is_active = models.BooleanField(default=True)

    # ── connection ──────────────────────────────────────────────────────────
    protocol = models.CharField(max_length=8, choices=Protocol.choices, default=Protocol.IMAP)
    host = models.CharField(max_length=255, blank=True, default="")
    port = models.PositiveIntegerField(default=993)
    use_ssl = models.BooleanField(default=True)
    username = models.CharField(max_length=255, blank=True, default="")
    folder = models.CharField(max_length=120, default="INBOX")
    auth_method = models.CharField(max_length=20, choices=AuthMethod.choices, default=AuthMethod.BASIC)

    # ── OAuth app (per-org) — each org registers its OWN provider app ────────
    # Multi-tenant: the client id/secret are NOT shared global settings; each org
    # supplies its own Azure/Google app credentials so consent happens inside its
    # own directory. Blank ⇒ fall back to the global settings app (single-app mode).
    oauth_client_id = models.CharField(max_length=255, blank=True, default="")
    oauth_client_secret_enc = EncryptedField(blank=True, default="")
    oauth_tenant_id = models.CharField(
        max_length=128, blank=True, default="",
        help_text="Microsoft only: Directory (tenant) ID, or 'common'/'organizations'. Ignored for Google.",
    )

    # ── secrets (encrypted at rest) ─────────────────────────────────────────
    password_enc = EncryptedField(blank=True, default="")
    oauth_access_token_enc = EncryptedField(blank=True, default="")
    oauth_refresh_token_enc = EncryptedField(blank=True, default="")
    oauth_token_expiry = models.DateTimeField(null=True, blank=True)
    oauth_authorized = models.BooleanField(default=False)

    # ── outbound SMTP — the mailbox sends acknowledgements + agent replies ───
    # OAuth channels send via XOAUTH2 reusing the inbound oauth_*_token_enc.
    outbound_enabled = models.BooleanField(
        default=True, help_text="Send acknowledgement + agent‑reply mail FROM this mailbox."
    )
    smtp_host = models.CharField(max_length=255, blank=True, default="")
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_security = models.CharField(
        max_length=8, choices=SmtpSecurity.choices, default=SmtpSecurity.STARTTLS
    )
    smtp_username = models.CharField(
        max_length=255, blank=True, default="", help_text="Blank ⇒ reuse the inbound username."
    )
    smtp_password_enc = EncryptedField(
        blank=True, default="", help_text="Blank ⇒ reuse the inbound password (basic auth)."
    )
    smtp_from_name = models.CharField(
        max_length=150, blank=True, default="", help_text="Display name on the From header."
    )

    # ── processing behaviour (JSM parity) ───────────────────────────────────
    create_users = models.BooleanField(
        default=True, help_text="Create a (non‑login) requestor account for unknown senders."
    )
    default_requestor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        help_text="Used as requestor when create_users is off and the sender is unknown.",
    )
    default_priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    priority_map = models.JSONField(
        default=_default_priority_map, blank=True,
        help_text="Email priority signal (X-Priority/Importance/…) → ticket priority.",
    )
    default_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    strip_quotes = models.BooleanField(default=True)
    cc_watchers = models.BooleanField(default=True)
    reopen_policy = models.CharField(
        max_length=16, choices=ReopenPolicy.choices, default=ReopenPolicy.COMMENT_ONLY
    )
    reopen_window_days = models.PositiveIntegerField(default=14)
    ignore_auto_replies = models.BooleanField(default=True)
    max_age_days = models.PositiveIntegerField(default=7)
    max_size_bytes = models.PositiveBigIntegerField(
        default=25 * 1024 * 1024, help_text="Whole‑message cap; larger mail is ignored (size_cap)."
    )
    max_attachment_bytes = models.PositiveBigIntegerField(
        default=10 * 1024 * 1024,
        help_text="Per‑attachment cap; larger parts are skipped (ticket is still created).",
    )
    loop_window_min = models.PositiveIntegerField(default=10)
    loop_max_messages = models.PositiveIntegerField(default=30)
    poll_interval_seconds = models.PositiveIntegerField(
        null=True, blank=True, help_text="Per‑channel override of the global poll cadence."
    )

    # ── polling cursor ──────────────────────────────────────────────────────
    last_polled_at = models.DateTimeField(null=True, blank=True)
    last_seen_uid = models.PositiveBigIntegerField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["is_active"])]

    def __str__(self):
        return f"{self.name} <{self.address}>"

    @property
    def effective_domain(self) -> str:
        if self.domain:
            return self.domain
        return self.address.split("@", 1)[-1] if "@" in self.address else self.address

    @property
    def is_oauth(self) -> bool:
        return self.auth_method in (AuthMethod.OAUTH_GOOGLE, AuthMethod.OAUTH_MICROSOFT)

    @property
    def effective_smtp_username(self) -> str:
        return self.smtp_username or self.username

    @property
    def effective_smtp_password(self) -> str:
        # EncryptedField returns plaintext in Python; fall back to the inbound password.
        return self.smtp_password_enc or self.password_enc

    @property
    def from_header(self) -> str:
        """RFC 5322 From for outbound mail: 'Display Name <support@…>'."""
        from email.utils import formataddr
        return formataddr((self.smtp_from_name or self.name or "", self.address))


class InboundEmail(BaseModel):
    """Durable record of every message we received — idempotency key + retry surface."""

    class Status(models.TextChoices):
        RECEIVED = "received", "Received"
        PROCESSED = "processed", "Processed"
        IGNORED = "ignored", "Ignored"
        FAILED = "failed", "Failed"

    channel = models.ForeignKey(EmailChannel, on_delete=models.PROTECT, related_name="inbound")
    message_id = models.CharField(max_length=998)
    in_reply_to = models.CharField(max_length=998, blank=True, default="")
    references = models.JSONField(default=list, blank=True)

    from_addr = models.EmailField(blank=True, default="")
    from_name = models.CharField(max_length=255, blank=True, default="")
    to_addrs = models.JSONField(default=list, blank=True)
    cc_addrs = models.JSONField(default=list, blank=True)
    subject = models.CharField(max_length=998, blank=True, default="")
    date_header = models.DateTimeField(null=True, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    headers = models.JSONField(default=dict, blank=True)
    body_text = models.TextField(blank=True, default="")

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RECEIVED)
    ignore_reason = models.CharField(max_length=40, blank=True, default="")
    action_taken = models.CharField(max_length=40, blank=True, default="")

    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    comment = models.ForeignKey(
        "itsm_tickets.Comment", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    requestor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["channel", "message_id"], name="uniq_inbound_channel_msgid"),
        ]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"]),
            models.Index(fields=["from_addr", "created_at"]),
            models.Index(fields=["message_id"]),
        ]

    def __str__(self):
        return f"{self.status}: {self.subject[:48]}"


class ThreadDirection(models.TextChoices):
    INBOUND = "inbound", "Inbound"
    OUTBOUND = "outbound", "Outbound"


class EmailThreadMessage(BaseModel):
    """Maps an RFC Message‑ID to a ticket so replies (in either direction) thread."""

    channel = models.ForeignKey(EmailChannel, on_delete=models.CASCADE, related_name="thread_messages")
    message_id = models.CharField(max_length=998)
    ticket = models.ForeignKey("itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="email_messages")
    comment = models.ForeignKey(
        "itsm_tickets.Comment", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    direction = models.CharField(max_length=10, choices=ThreadDirection.choices)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["channel", "message_id"], name="uniq_thread_channel_msgid"),
        ]
        indexes = [
            models.Index(fields=["message_id"]),
            models.Index(fields=["ticket"]),
        ]

    def __str__(self):
        return f"{self.direction} {self.message_id} → {self.ticket_id}"


class EmailRule(BaseModel):
    """Allow / block list. If any active allow rule exists for a channel, the
    sender must match one; block rules always win."""

    class RuleType(models.TextChoices):
        BLOCK = "block", "Block"
        ALLOW = "allow", "Allow"

    channel = models.ForeignKey(
        EmailChannel, null=True, blank=True, on_delete=models.CASCADE, related_name="rules",
        help_text="Null = applies to all channels.",
    )
    rule_type = models.CharField(max_length=8, choices=RuleType.choices)
    pattern = models.CharField(max_length=255, help_text="Exact address or glob, e.g. *@spam.com")
    is_active = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["rule_type", "pattern"]
        indexes = [models.Index(fields=["channel", "rule_type"])]

    def __str__(self):
        return f"{self.rule_type}:{self.pattern}"

    def matches(self, addr: str) -> bool:
        addr = (addr or "").strip().lower()
        return bool(addr) and fnmatch.fnmatch(addr, self.pattern.strip().lower())
