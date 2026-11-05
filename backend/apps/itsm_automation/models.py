"""Automation rules — per-project "When → If → Then".

A rule fires on a ticket event (``triggers``), checks a queue-style FilterSpec
(``conditions``), then runs an ordered list of ``actions`` through the existing
ticket/workflow services as the non-login ``automation-bot`` user. Every run is
recorded in ``AutomationRun`` so admins can see what fired and why it failed.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel, UUIDModel


class TriggerType(models.TextChoices):
    TICKET_CREATED = "ticket_created", "Ticket created"
    TICKET_UPDATED = "ticket_updated", "Ticket updated"
    STATUS_CHANGED = "status_changed", "Status changed"


class ActionType(models.TextChoices):
    TRANSITION = "transition", "Transition status"
    SET_FIELD = "set_field", "Set field"
    ADD_COMMENT = "add_comment", "Add comment"


MAX_ACTIONS = 5


class AutomationRule(BaseModel):
    project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.CASCADE, related_name="automation_rules"
    )
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=100)  # run order, ascending
    # [{type: TriggerType, config: {...}}] — any one matching trigger fires the rule.
    #   ticket_created  {}
    #   ticket_updated  {fields: ["assignee", "priority", "cf:<key>", ...]}  (empty = any)
    #   status_changed  {from_status_ids: [...], to_status_ids: [...]}      (empty = any)
    triggers = models.JSONField(default=list, blank=True)
    # Queue FilterSpec {match: all|any, conditions: [{field, op, value}]} — evaluated
    # with the queue compiler (query_builder.build_q). Empty = always true.
    conditions = models.JSONField(default=dict, blank=True)
    # [{type: ActionType, config: {...}}] — run in order, all-or-nothing per rule.
    #   transition   {transition_id, keep_assignee: bool}
    #                (keep_assignee is REDUNDANT since 2026-10-18: the workflow engine's
    #                 auto_assign never overwrites an existing assignee anyway. Kept
    #                 for API/stored-data compatibility only.)
    #   set_field    {field, value}
    #   add_comment  {body_html | canned_note_id, visibility: public|private}
    actions = models.JSONField(default=list, blank=True)
    stop_processing = models.BooleanField(default=False)  # skip later rules once this fires

    # Denormalised for the list UI (written by the dispatcher).
    last_run_at = models.DateTimeField(null=True, blank=True)
    run_count = models.PositiveIntegerField(default=0)
    failure_count = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["order", "created_at"]
        indexes = [models.Index(fields=["project", "is_active", "order"])]

    def __str__(self):
        return self.name


class AutomationRun(UUIDModel):
    """Append-only execution log — one row per rule that matched an event."""

    class Status(models.TextChoices):
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    rule = models.ForeignKey(AutomationRule, on_delete=models.CASCADE, related_name="runs")
    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="automation_runs"
    )
    event = models.CharField(max_length=32)
    status = models.CharField(max_length=10, choices=Status.choices)
    message = models.TextField(blank=True, default="")
    actions_result = models.JSONField(default=list, blank=True)  # [{type, status, detail}]
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["rule", "-created_at"])]

    def __str__(self):
        return f"{self.rule_id} {self.status} on {self.ticket_id}"
