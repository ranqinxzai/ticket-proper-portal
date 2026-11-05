"""What a project's automation rules may reference: the fields an "updated" trigger
can watch, and the fields a "set field" action can write. The serializer validates
against it, and the UI renders it (``GET /automation-rules/catalog/?project=``).

Each entry is ``{key, label, filter_key}``:
- ``key`` is what the rule stores. A built-in or column-backed field uses its Ticket
  column name (``priority``, ``impact``), which matches the names ``update_ticket``
  reports. A value-backed custom field uses ``cf:<key>``.
- ``filter_key`` points at the queue filter registry entry, which carries the type and
  options the value pickers need.
"""

from __future__ import annotations

from apps.itsm_core.models.fields import FieldType

# Trigger-only built-ins (watchable, not settable) + the settable built-ins.
_BUILTIN_WATCH = [
    ("assignee", "Assignee", "assignee"),
    ("assigned_group", "Group", "assigned_group"),
    ("priority", "Priority", "priority"),
    ("requestor", "Requestor", "requestor"),
    ("summary", "Summary", "summary"),
    ("description", "Description", None),
]
_BUILTIN_SET = [
    ("priority", "Priority", "priority"),
    ("assignee", "Assignee", "assignee"),
    ("assigned_group", "Group", "assigned_group"),
]
# Columns update_ticket can change, and so reports in changed_fields: the only
# column-backed fields worth watching. Others (e.g. a Mode field mapped to `source`)
# never change after create, so a trigger on them would never fire.
WATCHABLE_COLUMNS = {
    "impact", "urgency", "business_impact", "root_cause", "resolution_notes", "resolution_code",
    "workaround_notes", "investigation_reason", "users_affected", "service_downtime",
    "workaround_provided", "major_incident",
}
# Column-backed (maps_to) fields an action may write through update_ticket. The same
# set: every column update_ticket writes can be set (actions.clean_column_value checks
# the value). It was only impact/urgency until 2026-10-31, which hid Users Affected
# and the other ITIL fields from "Set field" (GridCrest).
SETTABLE_COLUMNS = WATCHABLE_COLUMNS
# Value-backed custom types a set_field action supports. Multi-value types store a
# list: multiselect = option values, cascade = the ordered path, group_picker = [id].
SETTABLE_CF_TYPES = {
    FieldType.TEXT, FieldType.MULTILINE, FieldType.NUMBER, FieldType.DATE,
    FieldType.DATETIME, FieldType.CHECKBOX, FieldType.DROPDOWN, FieldType.RADIO,
    FieldType.USER_PICKER, FieldType.MULTISELECT, FieldType.CASCADE, FieldType.GROUP_PICKER,
}


def _entry(key, label, filter_key, **extra):
    return {"key": key, "label": label, "filter_key": filter_key, **extra}


def _cascade(fd) -> dict:
    """What the path picker needs: the level names and every active node (``parent``
    is the parent node's id; top-level nodes have none)."""
    levels = (fd.config or {}).get("levels") or ["Category"]
    options = [
        {"id": str(o.pk), "value": o.value, "label": o.label,
         "parent": str(o.parent_id) if o.parent_id else None}
        for o in fd.options.filter(is_active=True, is_deleted=False).order_by("sort_order", "id")
    ]
    return {"levels": levels, "options": options}


def field_catalog(project) -> dict:
    from apps.itsm_core.models.fields import NO_VALUE_TYPES
    from apps.itsm_core.services import fields as field_service
    from apps.itsm_tickets.services.filter_fields import BUILTIN_TYPE

    watch = [_entry(k, label, fk) for k, label, fk in _BUILTIN_WATCH]
    settable = [_entry(k, label, fk) for k, label, fk in _BUILTIN_SET]
    for fd in field_service.get_field_definitions(project, applicable_only=True):
        if fd.field_type in NO_VALUE_TYPES:
            continue
        maps_to = (fd.config or {}).get("maps_to")
        if maps_to:
            # Built-ins (priority, assignee, description, …) are listed above already.
            if fd.key in BUILTIN_TYPE or maps_to not in WATCHABLE_COLUMNS:
                continue
            watch.append(_entry(maps_to, fd.name, f"cf:{fd.key}"))
            if maps_to in SETTABLE_COLUMNS:
                settable.append(_entry(maps_to, fd.name, f"cf:{fd.key}", field_type=fd.field_type))
            continue
        watch.append(_entry(f"cf:{fd.key}", fd.name, f"cf:{fd.key}"))
        if fd.field_type in SETTABLE_CF_TYPES:
            extra = {"cascade": _cascade(fd)} if fd.field_type == FieldType.CASCADE else {}
            settable.append(_entry(f"cf:{fd.key}", fd.name, f"cf:{fd.key}",
                                   field_type=fd.field_type, **extra))
    return {"update_fields": watch, "set_fields": settable}
