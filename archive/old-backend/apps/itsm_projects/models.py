"""Projects — the top-level container. Two seeded defaults: Incident & Request.

Engine config (default SLA policy, notification scheme, field layout, calendar)
is attached via FKs added in later milestones (M3/M5/M6) so each migration stays
self-contained.
"""

from __future__ import annotations

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q

from apps.itsm_core.models import BaseModel

KEY_VALIDATOR = RegexValidator(r"^[A-Z][A-Z0-9]{1,9}$", "Key must be 2–10 uppercase letters/digits.")


class ProjectType(models.TextChoices):
    INCIDENT = "incident", "Incident Management"
    SERVICE_REQUEST = "service_request", "Request Management"
    CUSTOM = "custom", "Custom"


class Project(BaseModel):
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", on_delete=models.CASCADE, related_name="projects"
    )
    name = models.CharField(max_length=150)
    key = models.CharField(max_length=10, unique=True, validators=[KEY_VALIDATOR])
    description = models.TextField(blank=True)
    project_type = models.CharField(max_length=20, choices=ProjectType.choices,
                                    default=ProjectType.CUSTOM)
    status = models.CharField(
        max_length=12, choices=[("active", "Active"), ("inactive", "Inactive")], default="active"
    )
    color = models.CharField(max_length=16, default="#6366f1")
    icon = models.CharField(max_length=32, blank=True)
    default_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    default_workflow = models.ForeignKey(
        "itsm_workflows.Workflow", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    lead = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_itsm_projects",
    )

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["key"]),
            models.Index(fields=["project_type", "status"]),
            models.Index(fields=["helpdesk", "status"]),
        ]
        constraints = [
            # Exactly one default Incident + one default Request project per helpdesk.
            # CUSTOM projects are unconstrained, and retired (soft-deleted) rows are
            # excluded so a reseed never collides with an archived project.
            models.UniqueConstraint(
                fields=["helpdesk", "project_type"],
                condition=Q(project_type__in=["incident", "service_request"], is_deleted=False),
                name="uniq_helpdesk_default_projecttype",
            ),
        ]

    def __str__(self):
        return f"{self.key} · {self.name}"


class TicketType(BaseModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="ticket_types")
    name = models.CharField(max_length=80)
    key = models.SlugField(max_length=50)
    icon = models.CharField(max_length=32, blank=True)
    base_category = models.CharField(
        max_length=20,
        choices=[("incident", "Incident"), ("service_request", "Service Request")],
        default="incident",
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="uniq_project_tickettype_key"),
        ]

    def __str__(self):
        return f"{self.project.key}:{self.name}"
