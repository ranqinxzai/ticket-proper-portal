"""Operational teams that own and work tickets."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class GroupType(models.TextChoices):
    SERVICE_DESK = "service_desk", "Service Desk"
    NETWORK = "network", "Network Team"
    INFRA = "infra", "Infrastructure Team"
    SECURITY = "security", "Security Team"
    APP_SUPPORT = "app_support", "Application Support Team"
    CUSTOM = "custom", "Custom"


class Group(BaseModel):
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="groups",
        help_text="Owning helpdesk; null = shared/global group.",
    )
    name = models.CharField(max_length=150, unique=True)
    key = models.SlugField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=20, choices=GroupType.choices, default=GroupType.CUSTOM)
    lead = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="led_groups",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class GroupMembership(BaseModel):
    class RoleInGroup(models.TextChoices):
        MEMBER = "member", "Member"
        LEAD = "lead", "Lead"

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_group_memberships"
    )
    role_in_group = models.CharField(max_length=10, choices=RoleInGroup.choices,
                                     default=RoleInGroup.MEMBER)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["group", "user"], name="uniq_group_user"),
        ]
        indexes = [models.Index(fields=["group", "is_active"])]

    def __str__(self):
        return f"{self.user_id}@{self.group.key}"


class GroupAssignmentState(BaseModel):
    """Round-robin cursor per group (one row). Locked with select_for_update
    during auto-assignment so two tickets never grab the same member."""

    group = models.OneToOneField(Group, on_delete=models.CASCADE, related_name="assignment_state")
    last_assigned_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    def __str__(self):
        return f"rr-state:{self.group.key}"


class RoutingRule(BaseModel):
    """Default ownership: match a ticket to a target group (+ optional assignee).
    Evaluated in ascending `priority`; first match wins."""

    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True,
        on_delete=models.CASCADE, related_name="routing_rules",
    )
    name = models.CharField(max_length=150)
    priority = models.PositiveIntegerField(default=100)
    match_spec = models.JSONField(default=dict, blank=True)  # {ticket_type, priority, field conds}
    target_group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="+")
    target_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["priority", "id"]
        indexes = [models.Index(fields=["project", "priority"])]

    def __str__(self):
        return self.name
