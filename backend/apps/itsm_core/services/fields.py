"""Field engine service — typed read/write of custom field values + layout lookup."""

from __future__ import annotations

from django.utils.dateparse import parse_datetime

from apps.itsm_core.models import (
    FieldDefinition,
    FieldLayout,
    FieldType,
    FieldValue,
)
from apps.itsm_core.models.fields import MULTI_VALUE_TYPES, NO_VALUE_TYPES, OPTION_TYPES
from apps.itsm_core.services.html import sanitize_html


def _coerce(field: FieldDefinition, raw) -> dict:
    """Map a raw input to the typed value_* columns for this field type."""
    t = field.field_type
    kw = dict(value_text="", value_number=None, value_date=None,
              value_bool=None, value_user=None, value_json=None)
    if raw in (None, ""):
        return kw
    if t == FieldType.RICHTEXT:
        # Rich-text bodies are rendered with dangerouslySetInnerHTML on the
        # client → sanitise on write (same allowlist as ticket descriptions).
        kw["value_text"] = sanitize_html(str(raw))
    elif t in (FieldType.TEXT, FieldType.MULTILINE,
               FieldType.DROPDOWN, FieldType.RADIO):
        kw["value_text"] = str(raw)
    elif t == FieldType.NUMBER:
        kw["value_number"] = raw
    elif t in (FieldType.DATE, FieldType.DATETIME):
        kw["value_date"] = parse_datetime(str(raw)) if not hasattr(raw, "isoformat") else raw
    elif t == FieldType.CHECKBOX:
        kw["value_bool"] = bool(raw) if not isinstance(raw, str) else raw.lower() in ("1", "true", "yes")
    elif t == FieldType.USER_PICKER:
        kw["value_user_id"] = raw
    elif t in MULTI_VALUE_TYPES or t == FieldType.GROUP_PICKER:
        kw["value_json"] = raw if isinstance(raw, list) else [raw]
    else:
        kw["value_text"] = str(raw)
    return kw


def _serialize(fv: FieldValue):
    t = fv.field.field_type
    if t in (FieldType.TEXT, FieldType.MULTILINE, FieldType.RICHTEXT,
             FieldType.DROPDOWN, FieldType.RADIO):
        return fv.value_text
    if t == FieldType.NUMBER:
        return float(fv.value_number) if fv.value_number is not None else None
    if t in (FieldType.DATE, FieldType.DATETIME):
        return fv.value_date.isoformat() if fv.value_date else None
    if t == FieldType.CHECKBOX:
        return fv.value_bool
    if t == FieldType.USER_PICKER:
        return str(fv.value_user_id) if fv.value_user_id else None
    if t in MULTI_VALUE_TYPES or t == FieldType.GROUP_PICKER:
        return fv.value_json or []
    return fv.value_text


def get_field_definitions(project, ticket_type=None):
    from django.db.models import Q
    return FieldDefinition.objects.filter(
        Q(project=project) | Q(project__isnull=True), is_deleted=False
    )


def get_values(ticket) -> dict:
    rows = FieldValue.objects.filter(ticket=ticket).select_related("field", "value_user")
    return {fv.field.key: _serialize(fv) for fv in rows}


def set_values(ticket, values: dict, user=None):
    """Upsert custom field values from {field_key: raw}. Logs field_changed."""
    from apps.itsm_core.services import log_event

    if not values:
        return
    defs = {f.key: f for f in get_field_definitions(ticket.project)}
    for key, raw in values.items():
        field = defs.get(key)
        if field is None:
            continue
        # Column-backed system fields (config.maps_to) and value-less types (attachment)
        # never store a FieldValue — their data lives on the Ticket column / subsystem.
        if field.field_type in NO_VALUE_TYPES or (field.config or {}).get("maps_to"):
            continue
        kw = _coerce(field, raw)
        fv, created = FieldValue.objects.get_or_create(ticket=ticket, field=field)
        old = _serialize(fv) if not created else None
        for attr, val in kw.items():
            setattr(fv, attr, val)
        fv.save()
        new = _serialize(fv)
        if old != new:
            log_event(ticket, user, "field_changed", field_key=key,
                      payload={"old": old, "new": new, "name": field.name})


def get_layout(project, ticket_type=None):
    """Most specific layout for (project, ticket_type), else the project default."""
    layout = None
    if ticket_type is not None:
        layout = FieldLayout.objects.filter(
            project=project, ticket_type=ticket_type, is_deleted=False
        ).first()
    if layout is None:
        layout = FieldLayout.objects.filter(
            project=project, ticket_type__isnull=True, is_deleted=False
        ).first()
    return layout


def validate_required(project, ticket_type, values: dict, *, portal_only: bool = False) -> dict:
    """Return {field_key: [msg]} for mandatory layout fields missing in `values`.

    A mandatory option field (dropdown/radio/multiselect/cascade) that has **no
    active options** is skipped — an unconfigured catalog can't be satisfied and
    must not deadlock creation (mirrors the create form's client-side guard).

    ``portal_only=True`` (the end-user Service Portal intake) additionally skips
    fields with ``portal_visible=False``: the portal never renders them, so requiring
    one would make every requestor submission permanently unsatisfiable. Agents
    validate the full mandatory set (they see non-portal fields)."""
    from apps.itsm_core.models.fields import OPTION_TYPES

    layout = get_layout(project, ticket_type)
    errors = {}
    if layout is None:
        return errors
    items = layout.items.filter(is_mandatory=True, is_hidden=False)
    if portal_only:
        items = items.filter(portal_visible=True)
    for item in items.select_related("field"):
        field = item.field
        if field.field_type in OPTION_TYPES and not field.options.filter(is_active=True).exists():
            continue
        key = field.key
        if values.get(key) in (None, "", []):
            errors[key] = ["This field is required."]
    return errors
