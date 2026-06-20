"""Append-only audit feed for tickets.

Written ONLY via explicit ``log_event()`` calls at each write site — no Django
signals. This is deliberate: it keeps the audit trail greppable and lets us
capture the *previous* value in the payload (which post_save can't give us).
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from .base import UUIDModel


class AuditEvent(UUIDModel):
    class Action(models.TextChoices):
        TICKET_CREATED = "ticket_created", "Ticket created"
        FIELD_CHANGED = "field_changed", "Field changed"
        STATUS_CHANGED = "status_changed", "Status changed"
        ASSIGNED = "assigned", "Assignee changed"
        GROUP_CHANGED = "group_changed", "Group changed"
        PRIORITY_CHANGED = "priority_changed", "Priority changed"
        COMMENT_ADDED = "comment_added", "Comment added"
        COMMENT_EDITED = "comment_edited", "Comment edited"
        COMMENT_DELETED = "comment_deleted", "Comment deleted"
        ATTACHMENT_ADDED = "attachment_added", "Attachment added"
        ATTACHMENT_REMOVED = "attachment_removed", "Attachment removed"
        WATCHER_ADDED = "watcher_added", "Watcher added"
        WATCHER_REMOVED = "watcher_removed", "Watcher removed"
        LINK_ADDED = "link_added", "Ticket linked"
        LINK_REMOVED = "link_removed", "Ticket link removed"
        SLA_STARTED = "sla_started", "SLA started"
        SLA_PAUSED = "sla_paused", "SLA paused"
        SLA_RESUMED = "sla_resumed", "SLA resumed"
        SLA_BREACHED = "sla_breached", "SLA breached"
        REOPENED = "reopened", "Ticket reopened"
        CLOSED = "closed", "Ticket closed"
        TEMPLATE_APPLIED = "template_applied", "Template applied"

    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="activity"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=32, choices=Action.choices)
    field_key = models.CharField(max_length=80, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["ticket", "-created_at"])]

    def __str__(self):
        return f"{self.action} on {self.ticket_id}"
