"""Ticket — the heart of the platform. Standard ITIL fields are first-class
columns (indexed for queue / SLA / reporting); custom fields live in the
itsm_core field engine (M3)."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class Priority(models.TextChoices):
    CRITICAL = "critical", "Critical"
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"


class Source(models.TextChoices):
    AGENT = "agent", "Agent"
    PORTAL = "portal", "Portal"
    EMAIL = "email", "Email"
    PHONE = "phone", "Phone"
    API = "api", "API"


class TicketSequence(models.Model):
    """One row per project; the locked counter behind ticket numbers."""
    project = models.OneToOneField(
        "itsm_projects.Project", on_delete=models.CASCADE, related_name="ticket_sequence"
    )
    last_number = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.project.key}:{self.last_number}"


class Ticket(BaseModel):
    ticket_number = models.CharField(max_length=24, unique=True)
    project = models.ForeignKey("itsm_projects.Project", on_delete=models.PROTECT, related_name="tickets")
    ticket_type = models.ForeignKey("itsm_projects.TicketType", on_delete=models.PROTECT, related_name="tickets")

    summary = models.CharField(max_length=500)
    description_html = models.TextField(blank=True, default="")
    description_text = models.TextField(blank=True, default="")

    requestor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="requested_tickets",
    )
    assigned_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets"
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="assigned_tickets",
    )

    status = models.ForeignKey("itsm_workflows.Status", on_delete=models.PROTECT, related_name="+")
    workflow = models.ForeignKey("itsm_workflows.Workflow", on_delete=models.PROTECT, related_name="+")

    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    impact = models.CharField(max_length=10, choices=Priority.choices, blank=True, default="")
    urgency = models.CharField(max_length=10, choices=Priority.choices, blank=True, default="")
    resolution = models.CharField(max_length=120, blank=True, default="")

    due_date = models.DateTimeField(null=True, blank=True)
    first_responded_at = models.DateTimeField(null=True, blank=True)
    assigned_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    reopen_count = models.PositiveIntegerField(default=0)

    source = models.CharField(max_length=10, choices=Source.choices, default=Source.AGENT)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_tickets",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["assignee", "status"]),
            models.Index(fields=["assigned_group", "status"]),
            models.Index(fields=["project", "status", "priority"]),
            models.Index(fields=["priority"]),
            models.Index(fields=["due_date"]),
            models.Index(fields=["resolved_at"]),
            models.Index(fields=["ticket_number"]),
        ]

    def __str__(self):
        return f"{self.ticket_number} · {self.summary[:60]}"


class Watcher(BaseModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="watchers")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="watched_tickets")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["ticket", "user"], name="uniq_ticket_watcher")]
        indexes = [models.Index(fields=["user"])]


class TicketLink(BaseModel):
    class LinkType(models.TextChoices):
        RELATES_TO = "relates_to", "relates to"
        BLOCKS = "blocks", "blocks"
        BLOCKED_BY = "blocked_by", "is blocked by"
        DUPLICATES = "duplicates", "duplicates"
        DUPLICATED_BY = "duplicated_by", "is duplicated by"
        CAUSES = "causes", "causes"
        CAUSED_BY = "caused_by", "is caused by"

    source_ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="links_out")
    target_ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="links_in")
    link_type = models.CharField(max_length=20, choices=LinkType.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source_ticket", "target_ticket", "link_type"],
                                    name="uniq_ticket_link"),
        ]


def ticket_attachment_path(instance, filename):
    return f"itsm_attachments/ticket/{instance.ticket_id}/{filename}"


class TicketAttachment(BaseModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=ticket_attachment_path)
    original_name = models.CharField(max_length=500, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=120, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )


class Comment(BaseModel):
    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Internal (agents only)"

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    visibility = models.CharField(max_length=8, choices=Visibility.choices, default=Visibility.PUBLIC)
    body_html = models.TextField(blank=True, default="")
    body_text = models.TextField(blank=True, default="")
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["ticket", "created_at"]),
            models.Index(fields=["ticket", "visibility"]),
        ]


def comment_attachment_path(instance, filename):
    return f"itsm_attachments/comment/{instance.comment_id}/{filename}"


class CommentAttachment(BaseModel):
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=comment_attachment_path)
    original_name = models.CharField(max_length=500, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=120, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )


class MentionRecord(BaseModel):
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name="mentions")
    mentioned_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_mentions"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["comment", "mentioned_user"], name="uniq_comment_mention"),
        ]


# ── Canned notes ────────────────────────────────────────────────────────────

class CannedNoteCategory(BaseModel):
    name = models.CharField(max_length=120)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class CannedNote(BaseModel):
    category = models.ForeignKey(
        CannedNoteCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="notes"
    )
    title = models.CharField(max_length=200)
    body_html = models.TextField(blank=True, default="")
    body_text = models.TextField(blank=True, default="")
    shortcut = models.SlugField(max_length=50, blank=True, default="")
    is_shared = models.BooleanField(default=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    usage_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["title"]
        indexes = [models.Index(fields=["is_shared"]), models.Index(fields=["shortcut"])]

    def __str__(self):
        return self.title


# ── Ticket templates ────────────────────────────────────────────────────────

class TemplateCategory(BaseModel):
    name = models.CharField(max_length=120)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class TicketTemplate(BaseModel):
    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True, on_delete=models.CASCADE, related_name="templates"
    )
    category = models.ForeignKey(
        TemplateCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="templates"
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    ticket_type = models.ForeignKey(
        "itsm_projects.TicketType", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    default_priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    default_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    default_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    summary_template = models.CharField(max_length=500, blank=True, default="")
    description_html = models.TextField(blank=True, default="")
    field_defaults = models.JSONField(default=dict, blank=True)  # {field_key: value}
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["project", "is_active"])]

    def __str__(self):
        return self.name
