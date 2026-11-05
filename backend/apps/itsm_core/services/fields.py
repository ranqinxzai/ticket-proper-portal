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
    naturally empty.

    Column-backed ITIL fields (``COLUMN_BACKED_CF`` — Resolution Notes, Impact …)
    have no ``FieldValue``: their cells are read off the Ticket column instead, in
    one more query, formatted the same way (option label, number, bool, text)."""
    from apps.itsm_tickets.services.filter_fields import COLUMN_BACKED_CF, MAPPED_COMPILE

    keys = list(keys or [])
    if not ticket_ids or not keys:
        return {}
    # The global column-backed defs among the requested keys (key == maps_to column).
    mapped = {
        fd.key: fd
        for fd in FieldDefinition.objects.filter(
            key__in=keys, project__isnull=True, is_deleted=False,
        )
        if (fd.config or {}).get("maps_to") == fd.key and fd.key in COLUMN_BACKED_CF
    }
    rows = list(
        FieldValue.objects.filter(
            ticket_id__in=list(ticket_ids), field__key__in=keys, is_deleted=False,
        ).select_related("field", "value_user")
    )
    option_field_ids = {fv.field_id for fv in rows if fv.field.field_type in OPTION_TYPES}
    option_field_ids |= {fd.id for fd in mapped.values() if fd.field_type in OPTION_TYPES}
    opt_labels: dict = {}
    if option_field_ids:
        from apps.itsm_core.models import FieldOption
        for o in FieldOption.objects.filter(field_id__in=option_field_ids, is_deleted=False):
            opt_labels[(o.field_id, o.value)] = o.label
    out: dict = {}
    for fv in rows:
        out.setdefault(fv.ticket_id, {})[fv.field.key] = _display(fv, opt_labels)
    if mapped:
        from apps.itsm_tickets.models import Ticket
        paths = {key: MAPPED_COMPILE[key]["path"] for key in mapped}
        for row in Ticket.objects.filter(id__in=list(ticket_ids)).values("id", *paths.values()):
            for key, fd in mapped.items():
                value = _display_column(fd, row[paths[key]], opt_labels)
                if value is not None:
                    out.setdefault(row["id"], {})[key] = value
    return out


def _display_column(fd: FieldDefinition, raw, opt_labels: dict) -> object:
    """``_display`` for a column-backed field: the raw Ticket column value → the
    same display shape a value-backed cell of that field type gets."""
    if raw is None or raw == "":
        return None
    t = fd.field_type
    if t in OPTION_TYPES:
        return opt_labels.get((fd.id, raw), raw)
    if t == FieldType.NUMBER:
        return float(raw)
    if t == FieldType.CHECKBOX:
        return bool(raw)
    return str(raw).strip() or None


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


def column_sort_expression(fd: FieldDefinition):
    """Ordering expression for a column-backed ITIL ``cf:`` queue column, or
    ``None`` (not in ``COLUMN_BACKED_CF`` / unorderable type). Like
    ``custom_sort_subquery`` it sorts by what the cell displays: an option field by
    its option *label*, everything else by the Ticket column itself. A blank text
    column sorts as NULL (last ASC), like a ticket with no ``FieldValue``."""
    from django.db.models import CharField, F, OuterRef, Subquery, TextField, Value
    from django.db.models.functions import Coalesce, NullIf

    from apps.itsm_core.models import FieldOption
    from apps.itsm_tickets.services.filter_fields import COLUMN_BACKED_CF, MAPPED_COMPILE

    maps_to = (fd.config or {}).get("maps_to")
    if maps_to not in COLUMN_BACKED_CF or fd.field_type not in CF_SORTABLE_TYPES:
        return None
    path = MAPPED_COMPILE[maps_to]["path"]
    if fd.field_type in (FieldType.DROPDOWN, FieldType.RADIO):
        label = Subquery(
            FieldOption.objects.filter(
                field_id=fd.id, value=OuterRef(path), is_deleted=False,
            ).values("label")[:1]
        )
        return Coalesce(label, NullIf(F(path), Value("")), output_field=CharField())
    if MAPPED_COMPILE[maps_to]["kind"] == "text":
        return NullIf(F(path), Value(""), output_field=TextField())
    return F(path)


def set_values(ticket, values: dict, user=None, *, notify_automation=False):
    """Upsert custom field values from {field_key: raw}. Logs field_changed.

    Returns the keys whose stored value actually changed. ``notify_automation=True``
    (the agent's set-fields edit) also fires the ``ticket_updated`` automation
    trigger with ``cf:<key>`` field names once the write commits. Internal callers
    (create, transition screens, move) leave it off; their own events cover them."""
    from django.db import transaction

    from apps.itsm_core.services import hooks, log_event

    if not values:
        return []
    changed: list[str] = []
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
            changed.append(key)
            log_event(ticket, user, "field_changed", field_key=key,
                      payload={"old": old, "new": new, "name": field.name})
    if notify_automation and changed:
        keys = [f"cf:{k}" for k in changed]
        transaction.on_commit(lambda: hooks.automation_dispatch(
            "ticket_updated", ticket, actor=user, changed_fields=keys))
    return changed


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


def _rule_text(v) -> str:
    """A value as JavaScript's ``String(v)`` renders it — the forms' ``evalRule``
    compares that, so the server must too (bool → "true", list → "a,b", 1.0 → "1")."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, tuple)):
        return ",".join(_rule_text(x) for x in v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def visibility_state(rule, values: dict) -> tuple[bool, bool]:
    """``(visible, readonly)`` for a layout item's ``visibility_rule`` against the
    submitted values (keyed by field key). Mirrors the forms' ``normRule`` +
    ``evalRule`` (``ticket-create-form.tsx``) exactly:

    - no rule → visible, editable; legacy ``{field, equals}`` is accepted;
    - a condition field with no value (absent / None / "") never matches — so a
      rule on ``status`` never matches at create (a new ticket has no status);
    - ``show`` → visible only while matched; ``readonly`` → locked while matched;
    - a multiselect (list) value: ``eq`` = the list INCLUDES the target (or equals it
      as JS ``String()``, kept for older rules typed as "a,b"); an empty list is "no
      value".
    """
    if not isinstance(rule, dict) or not rule.get("field"):
        return True, False
    target = rule.get("value")
    if target is None:
        target = rule.get("equals")
    target = _rule_text(target)
    cv = values.get(str(rule["field"]))
    is_list = isinstance(cv, (list, tuple))
    has = cv is not None and cv != "" and not (is_list and len(cv) == 0)
    eq = has and (_rule_text(cv) == target
                  or (is_list and target in [_rule_text(x) for x in cv]))
    matched = (has and not eq) if rule.get("operator") == "neq" else eq
    if rule.get("action") == "readonly":
        return True, matched
    return matched, False


def _is_blank(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return not v.strip()
    if isinstance(v, (list, tuple, dict)):
        return len(v) == 0
    return False


def has_choices(field: FieldDefinition) -> bool:
    """Whether an option-type field offers anything to pick: an active option (for
    cascade, an active TOP-LEVEL node — children of a deleted parent are unreachable).
    Non-option types always "have choices"."""
    if field.field_type not in OPTION_TYPES:
        return True
    qs = field.options.filter(is_active=True)
    if field.field_type == FieldType.CASCADE:
        qs = qs.filter(parent__isnull=True)
    return qs.exists()


def validate_required(project, ticket_type, values: dict, *, portal_only: bool = False,
                      columns: dict | None = None) -> dict:
    """Return ``{field_key: [msg]}`` for mandatory layout fields missing from a
    create submission. Used by the agent create endpoint and the portal intake —
    NOT by system creates (email, automation, move, seeds), which call
    ``ticket_service.create_ticket`` directly.

    ``values`` is keyed by **field key** (the portal sends every field that way;
    agent create sends value-backed fields in ``custom_fields``). ``columns`` (agent
    create) supplies column-backed (``config.maps_to``) values keyed by their Ticket
    column; a field is looked up under its key first, then its column.

    A mandatory field is NOT required when (the forms apply the same rules):
    - its layout item is Hidden, or (``portal_only``) has Portal off;
    - its ``visibility_rule`` hides it ("show when …" not met) or locks it
      ("read-only when …" met) — a locked field can't be filled in;
    - it's an option field with no choices (an unconfigured catalog must not
      deadlock creation);
    - it's an attachment (files upload after the ticket exists; the forms check them);
    - its definition was deleted, or it's a global that doesn't apply to this
      project type (the agent form never renders those)."""
    layout = get_layout(project, ticket_type)
    errors: dict = {}
    if layout is None:
        return errors
    items = layout.items.filter(is_mandatory=True, is_hidden=False, field__is_deleted=False)
    if portal_only:
        items = items.filter(portal_visible=True)
    items = list(items.select_related("field"))
    if not items:
        return errors

    current = dict(values or {})
    if columns:
        for f in get_field_definitions(project):
            col = (f.config or {}).get("maps_to")
            if col and f.key not in current and col in columns:
                current[f.key] = columns[col]
    inapplicable = set(inapplicable_global_keys(getattr(project, "project_type", None)))

    for item in items:
        field = item.field
        # Attachments upload after the ticket exists (the forms check them). The
        # Asset picker stores no FieldValue but IS checked: its value is the
        # ``assets`` id list (agent create) / the field key (portal).
        if field.field_type == "attachment":
            continue
        if field.project_id is None and field.key in inapplicable:
            continue
        if not has_choices(field):
            continue
        visible, readonly = visibility_state(item.visibility_rule, current)
        if not visible or readonly:
            continue
        if _is_blank(current.get(field.key)):
            errors[field.key] = [f"{field.name} is required."]
    return errors
