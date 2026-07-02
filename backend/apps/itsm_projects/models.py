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


def default_priority_matrix():
    """The standard ITIL Priority Matrix — ``matrix[impact][urgency] -> priority``.

    Impact has four levels (low/medium/high/critical); Urgency three (low/medium/
    high). Values are ``Ticket.priority`` codes. Per-project customisable via
    ``Project.priority_matrix``; a module-level callable so Django can serialise the
    JSONField default. Drives ``itsm_tickets.services.priority.compute_priority`` and
    the live UI recalculation.
    """
    return {
        "critical": {"high": "critical", "medium": "critical", "low": "high"},
        "high":     {"high": "critical", "medium": "high",     "low": "medium"},
        "medium":   {"high": "high",     "medium": "medium",   "low": "low"},
        "low":      {"high": "medium",   "medium": "low",      "low": "low"},
    }


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
    calendar = models.ForeignKey(
        "itsm_sla.BusinessCalendar", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="projects",
        help_text="Business calendar this project's SLA clocks use; null = SLA policy / global default.",
    )
    lead = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Default ticket-queue column layout for this project — an ordered list of
    # column keys (see the shared queue column registry). Empty ⇒ built-in
    # default set. An agent may override this for themselves via
    # itsm_dashboards.QueueColumnPreference.
    queue_columns = models.JSONField(default=list, blank=True)
    # Default queue view for this project — a system view key ("open", "all", …)
    # or "saved:<uuid>". Blank ⇒ product default (PRODUCT_DEFAULT_VIEW_KEY,
    # i.e. "open"). A user may override this for themselves via
    # itsm_dashboards.QueueViewPreference.
    default_view_key = models.CharField(max_length=64, blank=True, default="")
    # System view keys hidden from this project's queue dropdown. "all" is never
    # stored here — the All-tickets view is always available.
    disabled_view_keys = models.JSONField(default=list, blank=True)
    # Whitelist of assignment-group ids selectable for this project's tickets — a
    # list of Group UUIDs (as strings). EMPTY ⇒ ALL groups are allowed (the
    # default: nothing is restricted). When non-empty, only these groups (plus the
    # project's own default_group, always implicitly allowed) may be assigned. The
    # group picker on the create form / detail view filters to this set, and the
    # ticket write paths reject a non-whitelisted group (see
    # apps.itsm_groups.services.allowed_group_ids_for).
    allowed_group_ids = models.JSONField(default=list, blank=True)
    # ITIL Priority Matrix — matrix[impact][urgency] -> priority code. Drives the
    # auto-calculated Priority on Incident tickets (see
    # apps.itsm_tickets.services.priority.compute_priority) and the live UI
    # recalculation. Per-project customisable in the Priority Matrix settings tab;
    # defaults to the standard ITIL matrix.
    priority_matrix = models.JSONField(default=default_priority_matrix, blank=True)
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


class ProjectMembership(BaseModel):
    """Per-user project access grant (the strict-whitelist row-level scope).

    A user only sees a project's workspace tab + its tickets/reports when they hold
    an active membership here (or are a helpdesk lead / the project's `lead` /
    superuser/manager — see ``services.accessible_project_ids``). Assigned from User
    Management alongside helpdesks. Soft-removable via ``is_active`` (the row stays).
    """

    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="itsm_project_memberships",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "user"], name="uniq_project_user"),
        ]
        indexes = [models.Index(fields=["project", "is_active"])]

    def __str__(self):
        return f"{self.project_id}:{self.user_id}"


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
