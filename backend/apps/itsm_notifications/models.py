"""Notification engine models: schemes/rules/templates, in-app inbox, and a
durable transactional outbox for email."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel

EVENT_CHOICES = [
    ("TicketCreated", "Ticket Created"),
    ("TicketUpdated", "Ticket Updated"),
    ("StatusChanged", "Status Changed"),
    ("Assigned", "Assigned"),
    ("CommentAdded", "Comment Added"),
    ("CommentAddedPrivate", "Internal Comment Added"),
    ("Mentioned", "Mentioned"),
    ("Resolved", "Resolved"),
    ("Closed", "Closed"),
    ("SLAWarning", "SLA Warning"),
    ("SLABreach", "SLA Breach"),
]


class NotificationChannel(models.TextChoices):
    """Delivery channels a rule can fan out to. Stored free-form in the JSON
    ``NotificationRule.channels`` list and the ``NotificationOutbox.channel``
    column (no DB enum), but this is the canonical, validated set surfaced to the
    API/UI. ``whatsapp`` is groundwork only — not yet delivered (see bus.py)."""

    IN_APP = "in_app", "In-App"
    EMAIL = "email", "Email"
    WHATSAPP = "whatsapp", "WhatsApp"


class EmailTemplate(BaseModel):
    name = models.CharField(max_length=150)
    event_type = models.CharField(max_length=40, choices=EVENT_CHOICES, blank=True, default="")
    subject_template = models.CharField(max_length=300)
    body_html_template = models.TextField(blank=True, default="")
    body_text_template = models.TextField(blank=True, default="")
    is_system = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class NotificationScheme(BaseModel):
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True, on_delete=models.CASCADE,
        related_name="notification_schemes",
    )
    is_default = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class NotificationRule(BaseModel):
    scheme = models.ForeignKey(NotificationScheme, on_delete=models.CASCADE, related_name="rules")
    event_type = models.CharField(max_length=40, choices=EVENT_CHOICES)
    recipients = models.JSONField(default=list, blank=True)  # selector strings
    channels = models.JSONField(default=list, blank=True)    # ["in_app","email"]
    email_template = models.ForeignKey(
        EmailTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    notify_actor = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=["scheme", "event_type"])]


class InAppNotification(BaseModel):
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_notifications"
    )
    event_type = models.CharField(max_length=40)
    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    title = models.CharField(max_length=300)
    body_text = models.TextField(blank=True, default="")
    link = models.CharField(max_length=500, blank=True, default="")
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read", "-created_at"])]


class NotificationOutbox(BaseModel):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        DEAD = "dead", "Dead"

    event_type = models.CharField(max_length=40)
    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    channel = models.CharField(max_length=12, default="email")
    rendered_subject = models.CharField(max_length=300, blank=True, default="")
    rendered_body = models.TextField(blank=True, default="")  # plain-text part
    rendered_html = models.TextField(blank=True, default="")  # HTML alternative (sent via attach_alternative)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")
    dedupe_key = models.CharField(max_length=120, unique=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "next_attempt_at"]),
                   models.Index(fields=["ticket"])]
