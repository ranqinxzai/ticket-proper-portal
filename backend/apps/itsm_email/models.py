"""Email Channel — connect a mailbox so inbound mail becomes tickets/comments
and outbound notifications thread back.

Models:
  - ``EmailChannel``          a configured mailbox + JSM‑style processing options.
  - ``EmailChannelProject``   whitelist join — the projects a mailbox may create/serve
                              tickets in (its ``project`` FK is the default among them).
  - ``EmailRoutingRule``      keyword → project routing (within the whitelist).
  - ``InboundEmail``          durable per‑message log; the idempotency + retry surface.
  - ``EmailThreadMessage``    message‑id ↔ ticket map (both directions) for threading.
  - ``EmailRule``             allow/block list entries.
  - ``HelpdeskEmailTransport`` per‑helpdesk OUTBOUND‑only transport (system/custom).

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


class RoutingMatchIn(models.TextChoices):
    SUBJECT = "subject", "Subject only"
    BODY = "body", "Body only"
    SUBJECT_BODY = "subject_body", "Subject or body"


class RoutingMatchType(models.TextChoices):
    ANY = "any", "Match any keyword"
    ALL = "all", "Match all keywords"


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
        "1": "p1", "2": "p2", "3": "p3", "4": "p4", "5": "p4",
        "high": "p2", "normal": "p3", "low": "p4",
        "urgent": "p1", "non-urgent": "p4",
    }


class EmailChannel(BaseModel):
    """A mailbox the platform polls for inbound requests."""

    name = models.CharField(max_length=150)
    project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.PROTECT, related_name="email_channels",
        help_text="Default/fallback project — inbound mail lands here when no routing rule matches.",
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

    # ── auto-detected outbound send capability ──────────────────────────────
    # Does this mailbox actually have permission to SEND (SMTP auth / M365 SMTP.Send)?
    # NULL = unknown/never probed. Set by the test-smtp action, the scheduled re-verify
    # sweep, and outbox self-heal. FAIL-OPEN: the outbox keeps sending FROM this mailbox
    # unless the value is explicitly False (a confirmed permanent failure), at which
    # point it falls back to the workspace/system transport — see outbox.flush.
    outbound_send_verified = models.BooleanField(null=True, blank=True, default=None)
    outbound_verified_at = models.DateTimeField(null=True, blank=True)
    outbound_verify_error = models.TextField(blank=True, default="")

    # ── processing behaviour (JSM parity) ───────────────────────────────────
    create_users = models.BooleanField(
        default=True, help_text="Create a (non‑login) requestor account for unknown senders."
    )
    default_requestor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        help_text="Used as requestor when create_users is off and the sender is unknown.",
    )
    default_priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.P3)
    priority_map = models.JSONField(
        default=_default_priority_map, blank=True,
        help_text="Email priority signal (X-Priority/Importance/…) → ticket priority.",
    )
    default_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    strip_quotes = models.BooleanField(default=True)
    strip_signatures = models.BooleanField(
        default=False,
        help_text="Cut the sender's signature block off the ticket description and "
                  "reply comments. Opt-in: review a few tickets before enabling.",
    )
    signature_markers = models.JSONField(
        default=list, blank=True,
        help_text="Extra sign-off phrases that start a signature, e.g. "
                  "[\"Thanks & Regards\", \"Best Regards\"]. Matched case-insensitively "
                  "against a whole line, on top of the built-in detection.",
    )
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
    # Which routing rule (if any) picked the project for a newly-created ticket. Null =
    # the mail fell through to the channel's fallback project. Surfaces on the email log.
    matched_rule = models.ForeignKey(
        "itsm_email.EmailRoutingRule", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
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


class EmailRoutingRule(BaseModel):
    """Keyword → project routing for a single (shared) mailbox.

    A mailbox keeps its ``EmailChannel.project`` as the *fallback* project. Each active
    rule tests the inbound mail's subject/body for its keywords (whole-word / phrase,
    case-insensitive) and, on the **first** match (by ``order``), routes the new ticket
    into ``target_project`` instead. No rule matches ⇒ the fallback project. The set of
    projects a mailbox *serves* is therefore derived — fallback ∪ active rule targets —
    and every target is constrained to the channel's own helpdesk (row-level scoping).

    Rules only pick the project; the assignment group and priority stay mailbox-level
    (``EmailChannel.default_group`` / ``priority_map``). Not the same thing as
    ``itsm_groups.RoutingRule`` (which auto-assigns an agent within a project).
    """

    channel = models.ForeignKey(
        EmailChannel, on_delete=models.CASCADE, related_name="routing_rules"
    )
    order = models.PositiveIntegerField(
        default=0, help_text="Evaluation order — lowest first; the first matching rule wins."
    )
    name = models.CharField(max_length=150, blank=True, default="")
    match_in = models.CharField(
        max_length=16, choices=RoutingMatchIn.choices, default=RoutingMatchIn.SUBJECT_BODY
    )
    match_type = models.CharField(
        max_length=8, choices=RoutingMatchType.choices, default=RoutingMatchType.ANY
    )
    keywords = models.JSONField(
        default=list, blank=True,
        help_text="Whole-word / phrase keywords (case-insensitive). Empty ⇒ the rule never matches.",
    )
    target_project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.PROTECT, related_name="+",
        help_text="Where matching mail lands. Must belong to the channel's helpdesk.",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "created_at"]
        indexes = [models.Index(fields=["channel", "is_active"])]

    def __str__(self):
        return f"{self.name or 'rule'} → {self.target_project_id}"


class EmailChannelProject(BaseModel):
    """Whitelist join — the projects a mailbox is ALLOWED to create/serve tickets in.

    The mailbox's ``project`` FK is the *default/fallback*; this set is the ceiling: inbound
    mail can only ever open a ticket in one of these projects (and every ``EmailRoutingRule``
    target must be one of them). So an admin who allows only Incident + Request guarantees
    email never files into Change. Every allowed project must belong to the channel's own
    helpdesk (row-level scoping). Explicit join (not a Django M2M) to match the codebase's
    ``itsm_projects.ProjectMembership`` convention. A channel with no rows is treated as
    "allowed = {its fallback project}" (backward compatible).
    """

    channel = models.ForeignKey(
        EmailChannel, on_delete=models.CASCADE, related_name="allowed_project_links"
    )
    project = models.ForeignKey("itsm_projects.Project", on_delete=models.CASCADE, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["channel", "project"], name="uniq_channel_allowed_project"),
        ]
        indexes = [models.Index(fields=["channel"])]

    def __str__(self):
        return f"{self.channel_id} allows {self.project_id}"


class TransportMode(models.TextChoices):
    SYSTEM = "system", "Use the platform's email (default)"
    CUSTOM = "custom", "Use our own email"


class HelpdeskEmailTransport(BaseModel):
    """Per-helpdesk OUTBOUND-only transport for notification emails.

    Two modes:
      - ``system`` (default): notifications relay through the platform's own SMTP
        (``settings.EMAIL_*``); the recipient sees the helpdesk's From name over
        ``PLATFORM_NOTIFY_FROM`` with Reply-To set to the helpdesk's own address.
        In this mode the SMTP/OAuth fields here are unused — the From identity
        comes from ``Helpdesk.notification_from_name/email``.
      - ``custom``: the org supplies its OWN transport — basic ``smtp`` OR
        Microsoft 365 ``oauth_microsoft`` (XOAUTH2 over SMTP) — and notifications
        for this helpdesk's projects send FROM ``address`` over it.

    This is send-only: there is NO IMAP/polling side (that's ``EmailChannel``). The
    field + property NAMES deliberately mirror ``EmailChannel`` so the shared send
    machinery — ``services.oauth`` (duck-typed), ``services.transport._connection_for``
    and ``services.mailbox.test_smtp`` — drives this model with no per-object code.

    A helpdesk with NO row behaves as ``system`` mode (see ``outbox.flush``). A row is
    provisioned lazily by the ``for-helpdesk`` API action on first open.
    """

    helpdesk = models.OneToOneField(
        "itsm_helpdesks.Helpdesk", on_delete=models.CASCADE, related_name="email_transport",
    )
    mode = models.CharField(max_length=8, choices=TransportMode.choices, default=TransportMode.SYSTEM)

    # ── identity (custom mode) ───────────────────────────────────────────────
    address = models.EmailField(
        blank=True, default="",
        help_text="The address custom-mode notifications are sent FROM (and the XOAUTH2 login).",
    )
    smtp_from_name = models.CharField(
        max_length=150, blank=True, default="", help_text="Display name on the From header."
    )

    # ── connection: basic SMTP or Microsoft 365 OAuth (send-only) ────────────
    auth_method = models.CharField(max_length=20, choices=AuthMethod.choices, default=AuthMethod.BASIC)
    outbound_enabled = models.BooleanField(
        default=True, help_text="Master switch checked by the send-capability probe."
    )
    smtp_host = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Blank for OAuth ⇒ the provider's default endpoint is used.",
    )
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_security = models.CharField(
        max_length=8, choices=SmtpSecurity.choices, default=SmtpSecurity.STARTTLS
    )
    smtp_username = models.CharField(
        max_length=255, blank=True, default="", help_text="Blank ⇒ reuse the From address."
    )
    smtp_password_enc = EncryptedField(blank=True, default="")

    # ── OAuth app (per-org) + granted tokens (encrypted at rest) ─────────────
    oauth_client_id = models.CharField(max_length=255, blank=True, default="")
    oauth_client_secret_enc = EncryptedField(blank=True, default="")
    oauth_tenant_id = models.CharField(
        max_length=128, blank=True, default="",
        help_text="Microsoft only: Directory (tenant) ID, or 'common'/'organizations'.",
    )
    oauth_scope_override = models.CharField(
        max_length=500, blank=True, default="",
        help_text="Blank ⇒ the provider default. Set send-only (SMTP.Send) for M365.",
    )
    oauth_access_token_enc = EncryptedField(blank=True, default="")
    oauth_refresh_token_enc = EncryptedField(blank=True, default="")
    oauth_token_expiry = models.DateTimeField(null=True, blank=True)
    oauth_authorized = models.BooleanField(default=False)

    # ── auto-detected send capability ────────────────────────────────────────
    # NULL = unknown/never probed (treated as "usable" — fail-open). True/False set
    # by the explicit test action, the scheduled re-verify sweep, and self-heal.
    send_verified = models.BooleanField(null=True, blank=True, default=None)
    verified_at = models.DateTimeField(null=True, blank=True)
    verify_error = models.TextField(blank=True, default="")

    def __str__(self):
        return f"{self.helpdesk_id} · {self.mode}"

    # ── properties the shared send path reads (mirror EmailChannel) ──────────
    @property
    def is_oauth(self) -> bool:
        return self.auth_method in (AuthMethod.OAUTH_GOOGLE, AuthMethod.OAUTH_MICROSOFT)

    @property
    def effective_smtp_username(self) -> str:
        return self.smtp_username or self.address

    @property
    def effective_smtp_password(self) -> str:
        # EncryptedField returns plaintext in Python; no inbound password to reuse.
        return self.smtp_password_enc

    @property
    def from_header(self) -> str:
        """RFC 5322 From for custom-mode outbound mail: 'Display Name <addr>'."""
        from email.utils import formataddr
        return formataddr((self.smtp_from_name or "", self.address))
