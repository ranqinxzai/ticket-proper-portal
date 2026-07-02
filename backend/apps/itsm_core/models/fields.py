"""Dynamic custom-field engine.

One typed row per (ticket, field) — the CellValue pattern — bound to a project +
ticket type and arranged by a Layout Designer. Standard ITIL fields stay on the
Ticket model; this engine handles only the *custom* layer so the hot Ticket
table stays lean and the dynamic layer can be queried independently.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel


class FieldType(models.TextChoices):
    TEXT = "text", "Text"
    MULTILINE = "multiline", "Multi-line Text"
    RICHTEXT = "richtext", "Rich Text"
    NUMBER = "number", "Number"
    DATE = "date", "Date"
    DATETIME = "datetime", "Date & Time"
    DROPDOWN = "dropdown", "Dropdown"
    MULTISELECT = "multiselect", "Multi-select"
    CHECKBOX = "checkbox", "Checkbox"
    RADIO = "radio", "Radio"
    USER_PICKER = "user_picker", "User Picker"
    GROUP_PICKER = "group_picker", "Group Picker"
    CASCADE = "cascade", "Cascading (dependent)"
    ATTACHMENT = "attachment", "Attachment"


# Field types whose value lives in value_json (multi-value).
MULTI_VALUE_TYPES = {FieldType.MULTISELECT, FieldType.CASCADE}
OPTION_TYPES = {FieldType.DROPDOWN, FieldType.MULTISELECT, FieldType.RADIO, FieldType.CASCADE}
# Types that never persist a FieldValue (the value lives elsewhere or is a column).
NO_VALUE_TYPES = {FieldType.ATTACHMENT}
MAX_CASCADE_DEPTH = 7


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
            # Scope uniqueness to LIVE rows only: a soft-deleted field must not keep
            # holding its (project, key) slot, otherwise recreating a field with the
            # same key/name after deletion fails with an IntegrityError.
            models.UniqueConstraint(
                fields=["project", "key"],
                condition=Q(is_deleted=False),
                name="uniq_project_field_key",
            ),
        ]
        indexes = [models.Index(fields=["project", "field_type"])]

    def __str__(self):
        return f"{self.key} ({self.field_type})"


class FieldOption(BaseModel):
    field = models.ForeignKey(FieldDefinition, on_delete=models.CASCADE, related_name="options")
    # For CASCADE fields, options form a tree: `parent` links a node to its level-above
    # node and `level` is the 1-based depth (1 = top). Flat option types leave both unset.
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="children",
    )
    level = models.PositiveSmallIntegerField(default=1)
    value = models.CharField(max_length=100)
    label = models.CharField(max_length=150)
    color = models.CharField(max_length=16, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            # Live rows only — a soft-deleted option must not block re-adding the
            # same value to the field.
            models.UniqueConstraint(
                fields=["field", "value"],
                condition=Q(is_deleted=False),
                name="uniq_field_option_value",
            ),
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
            # Live rows only — a soft-deleted value must not block re-setting the
            # same ticket+field value.
            models.UniqueConstraint(
                fields=["ticket", "field"],
                condition=Q(is_deleted=False),
                name="uniq_ticket_field",
            ),
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
            # Live rows only — a soft-deleted layout must not block recreating the
            # layout for the same project + ticket type.
            models.UniqueConstraint(
                fields=["project", "ticket_type"],
                condition=Q(is_deleted=False),
                name="uniq_project_type_layout",
            ),
        ]

    def __str__(self):
        return f"{self.project_id}:{self.name}"


class LayoutRegion(models.TextChoices):
    MAIN = "main", "Main"        # left, ticket-details column
    SIDEBAR = "sidebar", "Sidebar"  # right, other-details column


class FieldWidth(models.TextChoices):
    FULL = "full", "Full"  # 100% of the column
    HALF = "half", "Half"  # 50% (main region only)


# Rich text always spans the full width and lives in the main column.
FORCE_MAIN_FULL_TYPES = {FieldType.RICHTEXT}


class FieldLayoutItem(BaseModel):
    layout = models.ForeignKey(FieldLayout, on_delete=models.CASCADE, related_name="items")
    field = models.ForeignKey(FieldDefinition, on_delete=models.CASCADE, related_name="layout_items")
    sort_order = models.PositiveIntegerField(default=0)
    is_hidden = models.BooleanField(default=False)  # hidden on BOTH the agent + portal form
    # Shown on the end-user Service Portal request form. Independent of is_hidden:
    # a field can be visible to agents but hidden from requestors (e.g. assignment /
    # source / picker fields). Assignment maps_to columns are still force-ignored on
    # the portal `create` server-side regardless of this flag (defence in depth).
    portal_visible = models.BooleanField(default=True)
    is_mandatory = models.BooleanField(default=False)
    section = models.CharField(max_length=80, default="Details")
    region = models.CharField(max_length=10, choices=LayoutRegion.choices, default=LayoutRegion.MAIN)
    width = models.CharField(max_length=8, choices=FieldWidth.choices, default=FieldWidth.FULL)
    visibility_rule = models.JSONField(null=True, blank=True)  # {action, field, operator, value}

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            # Live rows only — after removing a field from a layout (soft delete),
            # re-adding the same field to that layout must not collide.
            models.UniqueConstraint(
                fields=["layout", "field"],
                condition=Q(is_deleted=False),
                name="uniq_layout_field",
            ),
        ]
