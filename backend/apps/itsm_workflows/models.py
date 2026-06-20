"""Workflow model — drives ticket status transitions and powers the visual
builder (statuses = nodes, transitions = edges). Conditions/validators/
post-functions are stored as JSON the engine dispatches on.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class StatusCategory(BaseModel):
    """Fixed three: To Do / In Progress / Done. Drives queue grouping + reporting."""

    class Key(models.TextChoices):
        TODO = "todo", "To Do"
        IN_PROGRESS = "in_progress", "In Progress"
        DONE = "done", "Done"

    key = models.CharField(max_length=20, choices=Key.choices, unique=True)
    name = models.CharField(max_length=50)
    color = models.CharField(max_length=16, default="#94a3b8")
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]

    def __str__(self):
        return self.name


class Workflow(BaseModel):
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    base_type = models.CharField(
        max_length=20,
        choices=[("incident", "Incident"), ("service_request", "Service Request"), ("custom", "Custom")],
        default="custom",
    )
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["is_active"])]

    def __str__(self):
        return self.name


class Status(BaseModel):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="statuses")
    name = models.CharField(max_length=80)
    key = models.SlugField(max_length=50)
    category = models.ForeignKey(StatusCategory, on_delete=models.PROTECT, related_name="statuses")
    color = models.CharField(max_length=16, default="#64748b")
    sort_order = models.PositiveIntegerField(default=0)
    is_initial = models.BooleanField(default=False)
    canvas_x = models.IntegerField(default=0)
    canvas_y = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["workflow", "key"], name="uniq_workflow_status_key"),
        ]
        indexes = [models.Index(fields=["workflow", "sort_order"])]

    def __str__(self):
        return f"{self.workflow.name}:{self.name}"


class AutoAssignmentRule(BaseModel):
    class Strategy(models.TextChoices):
        ROUND_ROBIN = "round_robin", "Round-robin within group"
        LEAST_LOADED = "least_loaded", "Least loaded member"
        GROUP_LEAD = "group_lead", "Group lead"
        FIXED_USER = "fixed_user", "Fixed user"
        KEEP_CURRENT = "keep_current", "Keep current assignee"

    name = models.CharField(max_length=120, blank=True)
    strategy = models.CharField(max_length=20, choices=Strategy.choices, default=Strategy.ROUND_ROBIN)
    target_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    fixed_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    config = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.name or self.strategy


class TransitionScreen(BaseModel):
    """A set of fields required/shown when a transition runs (e.g. Resolve → Resolution)."""

    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="screens")
    name = models.CharField(max_length=120)

    def __str__(self):
        return self.name


class TransitionScreenField(BaseModel):
    screen = models.ForeignKey(TransitionScreen, on_delete=models.CASCADE, related_name="fields")
    field_key = models.CharField(max_length=80)  # references a FieldDefinition.key or a core field
    is_mandatory = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]


class Transition(BaseModel):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="transitions")
    name = models.CharField(max_length=120)
    from_status = models.ForeignKey(
        Status, null=True, blank=True, on_delete=models.CASCADE, related_name="outgoing_transitions"
    )  # null = "create" transition into the initial status
    to_status = models.ForeignKey(Status, on_delete=models.CASCADE, related_name="incoming_transitions")
    is_global = models.BooleanField(default=False)  # available from any status
    sort_order = models.PositiveIntegerField(default=0)
    post_functions = models.JSONField(default=list, blank=True)  # [{type, config}]
    auto_assign_rule = models.ForeignKey(
        AutoAssignmentRule, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    screen = models.ForeignKey(
        TransitionScreen, null=True, blank=True, on_delete=models.SET_NULL, related_name="transitions"
    )

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [models.Index(fields=["workflow", "from_status"])]

    def __str__(self):
        src = self.from_status.name if self.from_status else "(create)"
        return f"{src} → {self.to_status.name}"


class TransitionCondition(BaseModel):
    class Type(models.TextChoices):
        ROLE_IN = "role_in", "User has role"
        GROUP_MEMBER = "group_member", "User is in assigned group"
        IS_ASSIGNEE = "is_assignee", "User is the assignee"
        FIELD_EQUALS = "field_equals", "Field equals value"

    transition = models.ForeignKey(Transition, on_delete=models.CASCADE, related_name="conditions")
    condition_type = models.CharField(max_length=30, choices=Type.choices)
    config = models.JSONField(default=dict, blank=True)
    negate = models.BooleanField(default=False)


class ReopenRule(BaseModel):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="reopen_rules")
    reopen_to_status = models.ForeignKey(Status, on_delete=models.CASCADE, related_name="+")
    window_days = models.PositiveIntegerField(default=14)
    requires_comment = models.BooleanField(default=True)

    def __str__(self):
        return f"reopen→{self.reopen_to_status.name} ({self.window_days}d)"
