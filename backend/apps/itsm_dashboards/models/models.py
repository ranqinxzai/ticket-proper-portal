"""Saved filters, dashboards, widgets, sharing."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class SavedFilter(BaseModel):
    """A reusable ticket query (JSON spec → ORM Q via query_builder). Powers
    queues, dashboard widgets, and bulk-op target selection.

    Scope (2026-10-18): a view belongs to the queue it was saved from —
    ``project`` set ⇒ that project's queue; ``project=null`` ⇒ the All-Tickets queue of
    ``helpdesk``. ``is_shared=False`` ⇒ personal (only the owner sees it, only in that
    queue); ``is_shared=True`` ⇒ everyone who can open that queue — and a shared
    All-Tickets view also lists in that helpdesk's project queues. ``helpdesk`` is
    only meaningful for ``project=null`` rows (a project view's helpdesk is
    ``project.helpdesk``); a legacy ``project=null, helpdesk=null`` row the backfill
    couldn't attribute is visible to its owner only. See SavedFilterViewSet."""

    name = models.CharField(max_length=150)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="itsm_saved_filters",
    )
    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True, on_delete=models.CASCADE,
        related_name="saved_filters",
    )
    # The helpdesk whose All-Tickets queue a cross-project (project=null) view
    # belongs to. Always null for project-scoped views.
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", null=True, blank=True, on_delete=models.CASCADE,
        related_name="saved_filters",
    )
    is_shared = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    query_spec = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["sort_order", "name"]
        indexes = [
            models.Index(fields=["owner"]),
            models.Index(fields=["is_shared"]),
            models.Index(fields=["project"]),
            models.Index(fields=["helpdesk"], name="itsm_savedfilter_helpdesk_idx"),
        ]

    def __str__(self):
        return self.name


class QueueColumnPreference(BaseModel):
    """Per-user, per-project ticket-queue column choice — an ordered list of
    column keys (see the shared column registry). Overrides the project's
    ``queue_columns`` default for this user only; an empty list means "fall back
    to the project / built-in default". At most one alive row per (owner, project)."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_queue_columns",
    )
    project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.CASCADE, related_name="queue_column_prefs",
    )
    columns = models.JSONField(default=list, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "project"],
                condition=models.Q(is_deleted=False),
                name="uniq_owner_project_columns",
            ),
        ]
        indexes = [models.Index(fields=["owner", "project"])]

    def __str__(self):
        return f"{self.owner_id}@{self.project_id}"


class QueueViewPreference(BaseModel):
    """Per-user, per-project default queue view — the view applied when this user
    opens the project queue with no explicit view in the URL. ``view_key`` is a
    system view key ("open", "all", …) or "saved:<uuid>"; blank ⇒ fall back to the
    project default, then the product default. At most one alive row per
    (owner, project) — mirrors ``QueueColumnPreference``."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_queue_views",
    )
    project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.CASCADE, related_name="queue_view_prefs",
    )
    view_key = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "project"],
                condition=models.Q(is_deleted=False),
                name="uniq_owner_project_view",
            ),
        ]
        indexes = [models.Index(fields=["owner", "project"])]

    def __str__(self):
        return f"{self.owner_id}@{self.project_id}:{self.view_key}"


class Dashboard(BaseModel):
    name = models.CharField(max_length=150)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="itsm_dashboards",
    )
    is_shared = models.BooleanField(default=False)
    layout = models.JSONField(default=list, blank=True)  # react-grid-layout positions

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Widget(BaseModel):
    class WidgetType(models.TextChoices):
        KPI = "kpi", "KPI Card"
        PIE = "pie", "Pie Chart"
        BAR = "bar", "Bar Chart"
        TREND = "trend", "Trend Chart"
        SLA = "sla", "SLA Widget"
        TICKET_LIST = "ticket_list", "Ticket List"

    dashboard = models.ForeignKey(Dashboard, on_delete=models.CASCADE, related_name="widgets")
    widget_type = models.CharField(max_length=20, choices=WidgetType.choices)
    title = models.CharField(max_length=150)
    saved_filter = models.ForeignKey(
        SavedFilter, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    config = models.JSONField(default=dict, blank=True)  # metric, group_by, colors
    sort_order = models.PositiveIntegerField(default=0)
    position = models.JSONField(default=dict, blank=True)  # {x,y,w,h}

    class Meta:
        ordering = ["sort_order", "id"]


class DashboardShare(BaseModel):
    dashboard = models.ForeignKey(Dashboard, on_delete=models.CASCADE, related_name="shares")
    shared_with_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    shared_with_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    can_edit = models.BooleanField(default=False)
