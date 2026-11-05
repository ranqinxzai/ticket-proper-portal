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
        TICKET_MOVED = "ticket_moved", "Ticket moved to another project"
        APPROVAL_CANCELLED = "approval_cancelled", "Approval cancelled"
        AUTOMATION_APPLIED = "automation_applied", "Automation rule applied"
        # Approval lifecycle on the ticket feed (used by itsm_approvals, 2026-10-18).
        APPROVAL_REQUESTED = "approval_requested", "Approval requested"
        APPROVAL_APPROVED = "approval_approved", "Approval approved"
        APPROVAL_REJECTED = "approval_rejected", "Approval rejected"
        # Asset Management phase 2: assets linked to / removed from the ticket.
        ASSET_LINKED = "asset_linked", "Asset linked"
        ASSET_UNLINKED = "asset_unlinked", "Asset unlinked"

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


class AdminAuditEvent(UUIDModel):
    """Append-only admin & security audit log (tenant-wide, NOT per ticket).

    One row per sign-in / failed sign-in, password event, user / role / permission /
    membership change and configuration change (helpdesks, projects, workflows,
    fields, SLA, email, notifications, surveys, approvals, automation, branding, SSO).
    Written ONLY through ``apps.itsm_core.services.audit`` (``record_event`` and the
    request-level mixins in ``apps.itsm_core.audit_mixin``) — never via signals.
    Ticket traffic is NOT recorded here; it already has the per-ticket ``AuditEvent``.

    ``action`` is a free CharField (no ``choices``) so a new verb needs no migration;
    ``Action`` below documents the vocabulary. Secrets are never stored: changed
    secret fields appear as ``"[redacted]"`` in ``changes``. Retention: kept forever
    for now (no purge job yet).
    """

    class Action(models.TextChoices):
        CREATE = "create", "Created"
        UPDATE = "update", "Updated"
        DELETE = "delete", "Deleted"
        LOGIN = "login", "Signed in"
        LOGIN_FAILED = "login_failed", "Sign-in failed"
        PASSWORD_CHANGED = "password_changed", "Password changed"
        PASSWORD_CHANGE_FAILED = "password_change_failed", "Password change failed"
        PASSWORD_RESET = "password_reset", "Password reset"
        PASSWORD_RESET_REQUESTED = "password_reset_requested", "Password reset requested"
        PASSWORD_RESET_FAILED = "password_reset_failed", "Password reset failed"
        USER_ACTIVATED = "user_activated", "User activated"
        USER_DEACTIVATED = "user_deactivated", "User deactivated"
        ROLE_CHANGED = "role_changed", "Role changed"
        PERMISSIONS_CHANGED = "permissions_changed", "Permissions changed"
        MEMBER_ADDED = "member_added", "Member added"
        MEMBER_REMOVED = "member_removed", "Member removed"
        REORDERED = "reordered", "Reordered"
        OAUTH_STARTED = "oauth_started", "Mailbox sign-in started"
        EXPORTED = "exported", "Audit log exported"

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Who, captured at write time: the username, the *attempted* username for a failed
    # sign-in, or "Platform admin: <name>" for a platform-console action.
    actor_label = models.CharField(max_length=150, blank=True, default="")
    action = models.CharField(max_length=40, db_index=True)
    # The RBAC module code of the area changed (e.g. "itsm.sla.policies"), or "auth".
    area = models.CharField(max_length=100, db_index=True)
    object_type = models.CharField(max_length=100, blank=True, default="")
    object_id = models.CharField(max_length=64, blank=True, default="")
    object_repr = models.CharField(max_length=255, blank=True, default="")
    # [{field, label, old, new, redacted?}] — a list so the order survives jsonb.
    changes = models.JSONField(default=list, blank=True)
    extra = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["area", "-created_at"]),
            models.Index(fields=["action", "-created_at"]),
            models.Index(fields=["actor", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.action} {self.area} {self.object_repr or self.object_id}".strip()
