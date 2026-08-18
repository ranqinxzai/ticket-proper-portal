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


def inapplicable_global_keys(project_type: str | None) -> list[str]:
    """Keys of the global ITIL defs whose ``config.applies_to`` list does NOT
    include ``project_type`` (an absent ``applies_to`` key ⇒ applies everywhere).

    ⚠️ Resolved with a **positive** filter (``config__has_key``) on purpose.
    Excluding on the JSON lookup directly (e.g. the old
    ``.exclude(project__isnull=True, config__incident_only=True)``) drops *every*
    global field: for a def that lacks the key, ``config -> 'applies_to'`` is
    NULL, so ``NOT(TRUE AND NULL)`` is NULL → the row is filtered out. The
    membership test therefore happens in Python over the tagged defs only.
    """
    tagged = FieldDefinition.objects.filter(
        project__isnull=True, config__has_key="applies_to", is_deleted=False
    ).values_list("key", "config")
    keys = []
    for key, config in tagged:
        applies = (config or {}).get("applies_to") or []
        if project_type not in applies:
            keys.append(key)
    return keys


def hide_inapplicable_globals(qs, project):
    """Drop globals that don't apply to `project` — the ``config.applies_to``-tagged
    ITIL defs on a project type outside their list (e.g. Impact on a Request
    project, Workaround on an Incident). `project` may be a Project or a pk/uuid str.

    The single source of the "which global fields does this project actually have?"
    rule, shared by the Fields tab / layout palette (`FieldDefinitionViewSet`) and the
    queue's filter registry (`filter_fields.custom_field_payload`).
    """
    from apps.itsm_projects.models import Project

    pk = getattr(project, "pk", project)
    if pk is None:
        return qs
    project_type = (
        Project.objects.filter(pk=pk).values_list("project_type", flat=True).first()
    )
    keys = inapplicable_global_keys(project_type)
    return qs.exclude(project__isnull=True, key__in=keys) if keys else qs


def get_field_definitions(project, ticket_type=None, *, applicable_only=False):
    """Field defs visible to `project`: its own + every global (``project=null``).

    ``applicable_only=True`` additionally hides globals that don't apply to this
    project (see `hide_inapplicable_globals`) — use it for anything that answers
    "which fields are present on this project?" (Fields tab, filter registry,
    column pickers), so those surfaces agree.
    """
    from django.db.models import Q
    qs = FieldDefinition.objects.filter(
        Q(project=project) | Q(project__isnull=True), is_deleted=False
    )
    return hide_inapplicable_globals(qs, project) if applicable_only else qs


def get_values(ticket) -> dict:
    rows = FieldValue.objects.filter(ticket=ticket).select_related("field", "value_user")
    return {fv.field.key: _serialize(fv) for fv in rows}


def _display(fv: FieldValue, opt_labels: dict) -> object:
    """A display-ready value for a queue custom-field cell — option labels (not
    stored values), a user's name (not id), and joined multi-values. ``opt_labels``
    maps ``(field_id, value) -> label`` for the option-type fields in the batch."""
    t = fv.field.field_type
    if t in (FieldType.TEXT, FieldType.MULTILINE):
        return fv.value_text or None
    if t in (FieldType.DROPDOWN, FieldType.RADIO):
        return opt_labels.get((fv.field_id, fv.value_text), fv.value_text) or None
    if t == FieldType.NUMBER:
        return float(fv.value_number) if fv.value_number is not None else None
    if t in (FieldType.DATE, FieldType.DATETIME):
        return fv.value_date.isoformat() if fv.value_date else None
    if t == FieldType.CHECKBOX:
        return fv.value_bool
    if t == FieldType.USER_PICKER:
        u = fv.value_user if fv.value_user_id else None
        if u is None:
            return None
        return (u.get_full_name() or u.username) if hasattr(u, "get_full_name") else str(u)
    if t in MULTI_VALUE_TYPES:
        vals = fv.value_json or []
        labels = [opt_labels.get((fv.field_id, v), v) for v in vals]
        sep = " › " if t == FieldType.CASCADE else ", "
        return sep.join(str(x) for x in labels) if labels else None
    if t == FieldType.GROUP_PICKER:
        vals = fv.value_json or []
        return ", ".join(str(x) for x in vals) if vals else None
    return fv.value_text or None


def custom_column_values(ticket_ids, keys) -> dict:
    """Batch-resolve display-ready custom-field values for a set of tickets.

    Returns ``{ticket_id: {field_key: display}}`` for the requested field ``keys``
    across ``ticket_ids`` in ONE ``FieldValue`` query (plus one options query) — the
    combined queue's custom columns use this so the list stays free of the per-row
    N+1 the list serializer deliberately avoids (unlike the detail's ``get_values``).
    Values are display-ready (option labels, user names) — richer than the raw
    ``_serialize`` the Ticket-Data export uses. A missing ``(ticket, field)`` simply
    has no entry (the cell renders blank), so a field absent from a row's project is
    naturally empty."""
    keys = list(keys or [])
    if not ticket_ids or not keys:
        return {}
    rows = list(
        FieldValue.objects.filter(
            ticket_id__in=list(ticket_ids), field__key__in=keys, is_deleted=False,
        ).select_related("field", "value_user")
    )
    option_field_ids = {fv.field_id for fv in rows if fv.field.field_type in OPTION_TYPES}
    opt_labels: dict = {}
    if option_field_ids:
        from apps.itsm_core.models import FieldOption
        for o in FieldOption.objects.filter(field_id__in=option_field_ids, is_deleted=False):
            opt_labels[(o.field_id, o.value)] = o.label
    out: dict = {}
    for fv in rows:
        out.setdefault(fv.ticket_id, {})[fv.field.key] = _display(fv, opt_labels)
    return out


# Field types whose stored value has a meaningful *column sort* order. Multi-value
# (multiselect / cascade / group_picker), markup (richtext) and value-less
# (attachment) types are deliberately excluded: their cell is a joined list or an
# HTML blob, so ordering by the stored value would look arbitrary to the agent.
# This is the ONE place that rule lives — the filter registry reads it to decide
# whether to publish an ``ordering_key`` (⇒ whether the queue header is clickable),
# and the ticket queryset reads it again before annotating. Don't re-test a type
# by hand at a call site.
CF_SORTABLE_TYPES = frozenset({
    FieldType.TEXT,
    FieldType.MULTILINE,
    FieldType.NUMBER,
    FieldType.DATE,
    FieldType.DATETIME,
    FieldType.CHECKBOX,
    FieldType.DROPDOWN,
    FieldType.RADIO,
    FieldType.USER_PICKER,
})


def custom_sort_subquery(key: str, field_type: str):
    """Correlated ordering expression for a ``cf:<key>`` queue column, or ``None``.

    Sorts by what the cell **displays** (`_display`), not by what is stored: an
    option's *label* rather than its stored value, a user's display name rather
    than the id — so the resulting order matches the column the agent clicked.
    Correlates on ``ticket`` so it works for the combined queue too (one key can
    resolve to a per-project ``FieldDefinition`` in each project — matching on
    ``field__key`` unions them exactly like the column itself does).

    Returns ``None`` for a type with no sane order (see ``CF_SORTABLE_TYPES``).
    A ticket with no value for the field sorts as NULL (Postgres: last ASC).
    """
    from django.db.models import OuterRef, Subquery, Value
    from django.db.models.functions import Coalesce, NullIf

    from apps.itsm_core.models import FieldOption

    if field_type not in CF_SORTABLE_TYPES:
        return None
    base = FieldValue.objects.filter(
        ticket=OuterRef("pk"), field__key=key, field__is_deleted=False, is_deleted=False,
    )
    if field_type in (FieldType.DROPDOWN, FieldType.RADIO):
        # value_text holds the option *value*; the cell renders the option label.
        label = Subquery(
            FieldOption.objects.filter(
                field=OuterRef("field"), value=OuterRef("value_text"), is_deleted=False,
            ).values("label")[:1]
        )
        return Subquery(base.annotate(_sort=Coalesce(label, "value_text")).values("_sort")[:1])
    if field_type == FieldType.USER_PICKER:
        return Subquery(
            base.annotate(
                _sort=Coalesce(NullIf("value_user__full_name", Value("")), "value_user__username")
            ).values("_sort")[:1]
        )
    column = {
        FieldType.NUMBER: "value_number",
        FieldType.DATE: "value_date",
        FieldType.DATETIME: "value_date",
        FieldType.CHECKBOX: "value_bool",
    }.get(field_type, "value_text")
    return Subquery(base.values(column)[:1])


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
