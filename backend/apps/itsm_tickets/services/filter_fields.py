"""Single source of truth for the ticket filter + sort engine.

Defines which fields are filterable, which operators each field *type* allows
(this list is also the validation whitelist), the safe ORM path for every
built-in field (never build a lookup from a raw client key — see ``query_builder``),
the ordering aliases that map UI column names to safe DB ordering keys, and the
built-in "system" saved views (All / Open / Unassigned / …).

Imported by both ``query_builder`` (to compile + validate) and ``views`` (to serve
``GET /tickets/filter-fields/``). Keep this declarative; the Q-building lives in
``query_builder``.
"""

from __future__ import annotations

from apps.itsm_core.models.fields import (
    NO_VALUE_TYPES,
    OPTION_TYPES,
    FieldType,
)

# ── operator sets per *filter type* (also the validation whitelist) ───────────
OPERATORS_BY_TYPE: dict[str, list[str]] = {
    "select": ["in", "not_in", "eq", "neq", "is_empty", "is_not_empty"],
    "multiselect": ["in", "not_in", "is_empty", "is_not_empty"],
    "choice": ["in", "not_in", "eq", "neq"],
    "user": ["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"],
    "date": [
        "on", "before", "after", "between",
        "today", "yesterday", "last_7_days", "last_30_days", "this_week", "this_month",
        "is_empty", "is_not_empty",
    ],
    "text": ["contains", "not_contains", "eq", "neq", "is_empty", "is_not_empty"],
    "number": ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
    "boolean": ["is_true", "is_false"],
}
# Extra relative operators only meaningful on the due date.
DUE_DATE_OPS = ["overdue", "due_today"]
# Operators that take no value (so the UI hides the value input).
VALUELESS_OPS = {
    "is_empty", "is_not_empty", "is_true", "is_false",
    "today", "yesterday", "last_7_days", "last_30_days", "this_week", "this_month",
    "overdue", "due_today",
}

# ── built-in field registry ──────────────────────────────────────────────────
# Each entry: key, label, filter `type`, optional inline `options`,
# `options_source` (a hint the frontend resolves via its own APIs), and
# `ordering_key` (the column-sort name the UI sends; translated via ORDERING_ALIASES).
_STATUS_CATEGORY_OPTIONS = [
    {"value": "todo", "label": "To Do"},
    {"value": "in_progress", "label": "In Progress"},
    {"value": "done", "label": "Done"},
]
_PRIORITY_OPTIONS = [
    {"value": "critical", "label": "Critical"},
    {"value": "high", "label": "High"},
    {"value": "medium", "label": "Medium"},
    {"value": "low", "label": "Low"},
]
_SOURCE_OPTIONS = [
    {"value": "agent", "label": "Agent"},
    {"value": "portal", "label": "Portal"},
    {"value": "email", "label": "Email"},
    {"value": "phone", "label": "Phone"},
    {"value": "api", "label": "API"},
]

BUILTIN_FIELDS: list[dict] = [
    {"key": "status", "label": "Status", "type": "select",
     "options_source": "statuses", "ordering_key": "status"},
    {"key": "status_category", "label": "Status category", "type": "choice",
     "options": _STATUS_CATEGORY_OPTIONS, "ordering_key": "status_category"},
    {"key": "priority", "label": "Priority", "type": "choice",
     "options": _PRIORITY_OPTIONS, "ordering_key": "priority"},
    {"key": "ticket_type", "label": "Type", "type": "select",
     "options_source": "ticket_types", "ordering_key": "type"},
    {"key": "assignee", "label": "Assignee", "type": "user",
     "options_source": "users", "ordering_key": "assignee"},
    {"key": "assigned_group", "label": "Group", "type": "select",
     "options_source": "groups"},
    {"key": "requestor", "label": "Requestor", "type": "user", "options_source": "users"},
    {"key": "created_by", "label": "Created by", "type": "user", "options_source": "users"},
    {"key": "source", "label": "Source", "type": "choice", "options": _SOURCE_OPTIONS},
    {"key": "created_at", "label": "Created", "type": "date", "ordering_key": "created_at"},
    {"key": "updated_at", "label": "Updated", "type": "date", "ordering_key": "updated_at"},
    {"key": "due_date", "label": "Due date", "type": "date", "ordering_key": "due_date"},
    {"key": "resolved_at", "label": "Resolved", "type": "date", "ordering_key": "resolved_at"},
    {"key": "summary", "label": "Summary", "type": "text", "ordering_key": "summary"},
    {"key": "ticket_number", "label": "Key", "type": "text", "ordering_key": "ticket_number"},
]

BUILTIN_TYPE: dict[str, str] = {f["key"]: f["type"] for f in BUILTIN_FIELDS}

# key -> {path, kind, nullable, user?} for the compiler. `path` is the ONLY ORM
# string ever interpolated for built-ins; nothing comes from raw client input.
BUILTIN_COMPILE: dict[str, dict] = {
    "status": {"path": "status_id", "kind": "fk", "nullable": False},
    "status_category": {"path": "status__category__key", "kind": "choice", "nullable": False},
    "priority": {"path": "priority", "kind": "choice", "nullable": False},
    "ticket_type": {"path": "ticket_type_id", "kind": "fk", "nullable": False},
    "assignee": {"path": "assignee_id", "kind": "fk", "nullable": True, "user": True},
    "assigned_group": {"path": "assigned_group_id", "kind": "fk", "nullable": True},
    "requestor": {"path": "requestor_id", "kind": "fk", "nullable": True, "user": True},
    "created_by": {"path": "created_by_id", "kind": "fk", "nullable": True, "user": True},
    "source": {"path": "source", "kind": "choice", "nullable": False},
    "created_at": {"path": "created_at", "kind": "date", "nullable": False},
    "updated_at": {"path": "updated_at", "kind": "date", "nullable": False},
    "due_date": {"path": "due_date", "kind": "date", "nullable": True},
    "resolved_at": {"path": "resolved_at", "kind": "date", "nullable": True},
    "summary": {"path": "summary", "kind": "text", "nullable": False},
    "ticket_number": {"path": "ticket_number", "kind": "text", "nullable": False},
}


def operators_for_key(key: str) -> list[str]:
    """Operators allowed for a built-in field key (due date gets relative extras)."""
    ftype = BUILTIN_TYPE.get(key)
    if ftype is None:
        return []
    ops = list(OPERATORS_BY_TYPE[ftype])
    if key == "due_date":
        ops = DUE_DATE_OPS + ops
    return ops


# ── sorting ──────────────────────────────────────────────────────────────────
PRIORITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}

# UI column name -> safe DB ordering target (validated against ORDERING_FIELDS).
ORDERING_ALIASES = {
    "priority": "priority_rank",
    "status": "status__sort_order",
    "status_category": "status__category__sort_order",
    "assignee": "assignee_name",
    "type": "ticket_type__name",
    "created": "created_at",
    "updated": "updated_at",
}
# Allowed ordering targets after alias translation.
ORDERING_FIELDS = [
    "created_at", "updated_at", "due_date", "resolved_at", "ticket_number", "summary",
    "priority_rank", "assignee_name", "status__sort_order",
    "status__category__sort_order", "ticket_type__name",
]

# ── built-in system views ────────────────────────────────────────────────────
# query_spec is the operator-based shape consumed by query_builder.build_q.
SYSTEM_VIEWS: list[dict] = [
    {"key": "all", "name": "All tickets", "query_spec": {}},
    {"key": "open", "name": "Open", "query_spec": {
        "conditions": [{"field": "status_category", "op": "in", "value": ["todo", "in_progress"]}]}},
    {"key": "unassigned", "name": "Unassigned", "query_spec": {
        "conditions": [{"field": "assignee", "op": "is_empty"}]}},
    {"key": "my_open", "name": "My open tickets", "query_spec": {
        "conditions": [
            {"field": "assignee", "op": "eq", "value": "me"},
            {"field": "status_category", "op": "in", "value": ["todo", "in_progress"]},
        ]}},
    {"key": "resolved", "name": "Resolved / Closed", "query_spec": {
        "conditions": [{"field": "status_category", "op": "in", "value": ["done"]}]}},
    {"key": "due_today", "name": "Due today", "query_spec": {
        "conditions": [{"field": "due_date", "op": "due_today"}]}},
    {"key": "overdue", "name": "Overdue", "query_spec": {
        "conditions": [{"field": "due_date", "op": "overdue"}]}},
    {"key": "created_this_week", "name": "Created this week", "query_spec": {
        "conditions": [{"field": "created_at", "op": "this_week"}]}},
    {"key": "recently_updated", "name": "Recently updated", "query_spec": {}, "ordering": "-updated_at"},
]

# The view a project queue resolves to when neither the user nor the project has
# chosen a default. Mirrored on the frontend (filter-utils PRODUCT_DEFAULT_VIEW_KEY).
PRODUCT_DEFAULT_VIEW_KEY = "open"


# ── custom-field type mapping ─────────────────────────────────────────────────
# FieldDefinition.field_type -> our filter `type`.
FILTER_TYPE_FROM_FIELDTYPE = {
    FieldType.TEXT: "text",
    FieldType.MULTILINE: "text",
    FieldType.RICHTEXT: "text",
    FieldType.NUMBER: "number",
    FieldType.DATE: "date",
    FieldType.DATETIME: "date",
    FieldType.CHECKBOX: "boolean",
    FieldType.DROPDOWN: "select",
    FieldType.RADIO: "select",
    FieldType.MULTISELECT: "multiselect",
    FieldType.CASCADE: "multiselect",
    FieldType.USER_PICKER: "user",
    FieldType.GROUP_PICKER: "multiselect",
}

# FieldDefinition.field_type -> FieldValue column used to store its value.
FIELDVALUE_COLUMN = {
    FieldType.TEXT: "value_text",
    FieldType.MULTILINE: "value_text",
    FieldType.RICHTEXT: "value_text",
    FieldType.DROPDOWN: "value_text",
    FieldType.RADIO: "value_text",
    FieldType.NUMBER: "value_number",
    FieldType.DATE: "value_date",
    FieldType.DATETIME: "value_date",
    FieldType.CHECKBOX: "value_bool",
    FieldType.USER_PICKER: "value_user_id",
    FieldType.MULTISELECT: "value_json",
    FieldType.CASCADE: "value_json",
    FieldType.GROUP_PICKER: "value_json",
}


def option_metadata(field_def) -> list[dict]:
    """Active options for a dropdown/radio/multiselect/cascade custom field."""
    return [
        {"value": o.value, "label": o.label, "color": o.color or None}
        for o in field_def.options.filter(is_active=True, is_deleted=False).order_by("sort_order", "id")
    ]


def custom_field_payload(project) -> list[dict]:
    """Filter-field metadata for every custom field visible to `project`."""
    from apps.itsm_core.services import fields as field_service

    out: list[dict] = []
    for fd in field_service.get_field_definitions(project):
        ft = fd.field_type
        if ft in NO_VALUE_TYPES:
            continue
        ftype = FILTER_TYPE_FROM_FIELDTYPE.get(ft)
        if not ftype:
            continue
        entry = {
            "key": f"cf:{fd.key}",
            "label": fd.name,
            "type": ftype,
            "operators": list(OPERATORS_BY_TYPE[ftype]),
            "group": "Custom fields",
        }
        if ft in OPTION_TYPES:
            entry["options"] = option_metadata(fd)
        if ft == FieldType.GROUP_PICKER:
            entry["options_source"] = "groups"
        out.append(entry)
    return out


def builtin_field_payload() -> list[dict]:
    out = []
    for f in BUILTIN_FIELDS:
        entry = {**f, "operators": operators_for_key(f["key"]), "group": "Standard"}
        out.append(entry)
    return out


def filter_fields_payload(project) -> dict:
    """The full {fields, system_views} payload for GET /tickets/filter-fields/."""
    return {
        "fields": builtin_field_payload() + custom_field_payload(project),
        "system_views": SYSTEM_VIEWS,
    }
