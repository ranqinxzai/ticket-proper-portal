"""Dynamic custom-field engine.

One typed row per (ticket, field) — the CellValue pattern — bound to a project +
ticket type and arranged by a Layout Designer. Standard ITIL fields stay on the
Ticket model; this engine handles only the *custom* layer so the hot Ticket
table stays lean and the dynamic layer can be queried independently.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from .base import BaseModel


class FieldType(models.TextChoices):
    TEXT = "text", "Text"
    MULTILINE = "multiline", "Multi-line Text"
    NUMBER = "number", "Number"
    DATE = "date", "Date"
    DATETIME = "datetime", "Date & Time"
    DROPDOWN = "dropdown", "Dropdown"
    MULTISELECT = "multiselect", "Multi-select"
    CHECKBOX = "checkbox", "Checkbox"
    RADIO = "radio", "Radio"
    USER_PICKER = "user_picker", "User Picker"
    GROUP_PICKER = "group_picker", "Group Picker"


# Field types whose value lives in value_json (multi-value).
MULTI_VALUE_TYPES = {FieldType.MULTISELECT}
OPTION_TYPES = {FieldType.DROPDOWN, FieldType.MULTISELECT, FieldType.RADIO}


class FieldDefinition(BaseModel):
    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True,
        on_delete=models.CASCADE, related_name="field_definitions",
    )  # null = global field available to all projects
    key = models.SlugField(max_length=80)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    field_type = models.CharField(max_length=20, choices=FieldType.choices)
    is_system = models.BooleanField(default=False)
    is_multi = models.BooleanField(default=False)
    config = models.JSONField(default=dict, blank=True)  # decimals, regex, min/max, show_time…
    default_json = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="uniq_project_field_key"),
        ]
        indexes = [models.Index(fields=["project", "field_type"])]

    def __str__(self):
        return f"{self.key} ({self.field_type})"


class FieldOption(BaseModel):
    field = models.ForeignKey(FieldDefinition, on_delete=models.CASCADE, related_name="options")
    value = models.CharField(max_length=100)
    label = models.CharField(max_length=150)
    color = models.CharField(max_length=16, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["field", "value"], name="uniq_field_option_value"),
        ]


class FieldValue(BaseModel):
    ticket = models.ForeignKey("itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="field_values")
    field = models.ForeignKey(FieldDefinition, on_delete=models.CASCADE, related_name="values")
    value_text = models.TextField(blank=True, default="")
    value_number = models.DecimalField(max_digits=24, decimal_places=6, null=True, blank=True)
    value_date = models.DateTimeField(null=True, blank=True)
    value_bool = models.BooleanField(null=True, blank=True)
    value_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    value_json = models.JSONField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["ticket", "field"], name="uniq_ticket_field"),
        ]
        indexes = [models.Index(fields=["field"]), models.Index(fields=["ticket"])]


class FieldLayout(BaseModel):
    project = models.ForeignKey("itsm_projects.Project", on_delete=models.CASCADE, related_name="field_layouts")
    ticket_type = models.ForeignKey(
        "itsm_projects.TicketType", null=True, blank=True,
        on_delete=models.CASCADE, related_name="field_layouts",
    )  # null = applies to all ticket types in the project (the project default)
    name = models.CharField(max_length=120, default="Default Layout")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "ticket_type"], name="uniq_project_type_layout"),
        ]

    def __str__(self):
        return f"{self.project_id}:{self.name}"


class FieldLayoutItem(BaseModel):
    layout = models.ForeignKey(FieldLayout, on_delete=models.CASCADE, related_name="items")
    field = models.ForeignKey(FieldDefinition, on_delete=models.CASCADE, related_name="layout_items")
    sort_order = models.PositiveIntegerField(default=0)
    is_hidden = models.BooleanField(default=False)
    is_mandatory = models.BooleanField(default=False)
    section = models.CharField(max_length=80, default="Details")
    visibility_rule = models.JSONField(null=True, blank=True)  # {field, equals} conditional show

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["layout", "field"], name="uniq_layout_field"),
        ]
