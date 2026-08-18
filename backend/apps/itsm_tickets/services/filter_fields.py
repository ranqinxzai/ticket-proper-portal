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
    {"value": "p1", "label": "P1 – Critical"},
    {"value": "p2", "label": "P2 – High"},
    {"value": "p3", "label": "P3 – Medium"},
    {"value": "p4", "label": "P4 – Low"},
]
_SOURCE_OPTIONS = [
    {"value": "agent", "label": "Agent"},
    {"value": "portal", "label": "Portal"},
    {"value": "email", "label": "Email"},
    {"value": "phone", "label": "Phone"},
    {"value": "api", "label": "API"},
]

BUILTIN_FIELDS: list[dict] = [
    {"key": "project", "label": "Project", "type": "select",
     "options_source": "projects", "ordering_key": "project"},
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
     "options_source": "groups", "ordering_key": "assigned_group"},
    {"key": "requestor", "label": "Requestor", "type": "user", "options_source": "users",
     "ordering_key": "requestor"},
    {"key": "created_by", "label": "Created by", "type": "user", "options_source": "users",
     "ordering_key": "created_by"},
    {"key": "source", "label": "Source", "type": "choice", "options": _SOURCE_OPTIONS},
    {"key": "created_at", "label": "Created", "type": "date", "ordering_key": "created_at"},
    {"key": "updated_at", "label": "Updated", "type": "date", "ordering_key": "updated_at"},
    {"key": "due_date", "label": "Due date", "type": "date", "ordering_key": "due_date"},
    {"key": "resolved_at", "label": "Resolved", "type": "date", "ordering_key": "resolved_at"},
    {"key": "summary", "label": "Summary", "type": "text", "ordering_key": "summary"},
    {"key": "ticket_number", "label": "Key", "type": "text", "ordering_key": "ticket_number"},
]

BUILTIN_TYPE: dict[str, str] = {f["key"]: f["type"] for f in BUILTIN_FIELDS}

# ── queue *column* keys (display layout, distinct from filter fields) ──────────
# The built-in columns the ticket-queue table can render, mirroring the frontend
# registry in ``components/tickets/queue-columns.tsx``. A saved column layout
# (``Project.queue_columns`` / ``Helpdesk.combined_queue_columns``) may hold any of
# these plus ``cf:<key>`` custom-field columns. Kept here so the write serializers
# validate against one source of truth.
QUEUE_COLUMN_KEYS: frozenset[str] = frozenset({
    "ticket_number", "project", "summary", "status", "priority", "requestor",
    "assignee", "assigned_group", "sla_response", "sla_resolution",
    "created_at", "created_by", "updated_at", "updated_by",
})


def clean_queue_columns(value, *, valid_cf: set[str] | None = None) -> list[str]:
    """Narrow a saved column layout to real columns: a known built-in, or a
    ``cf:<key>`` custom column. When ``valid_cf`` is given (the set of ``cf:<key>``
    a scope actually defines), unknown/stale custom columns are dropped too.
    Duplicates are removed, order preserved."""
    if not isinstance(value, list):
        return []
    cleaned: list[str] = []
    for raw in value:
        if not isinstance(raw, str) or raw in cleaned:
            continue
        if raw in QUEUE_COLUMN_KEYS:
            cleaned.append(raw)
        elif raw.startswith("cf:") and (valid_cf is None or raw in valid_cf):
            cleaned.append(raw)
    return cleaned

# key -> {path, kind, nullable, user?} for the compiler. `path` is the ONLY ORM
# string ever interpolated for built-ins; nothing comes from raw client input.
BUILTIN_COMPILE: dict[str, dict] = {
    "project": {"path": "project_id", "kind": "fk", "nullable": False},
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


# A column-backed custom field (`config.maps_to`) keeps its value on a Ticket column,
# never a FieldValue — so a `cf:` condition on one must compile against the COLUMN.
# Keyed by the `maps_to` column name → the safe ORM path + compile kind. This (with
# BUILTIN_COMPILE) is the ONLY source of an ORM path for a cf: condition; never build
# a lookup from the raw client key. Fields whose key is already a built-in (priority,
# requestor, assignee, assigned_group, source, summary) are not listed here — they
# delegate to BUILTIN_COMPILE by key instead.
MAPPED_COMPILE: dict[str, dict] = {
    # ITIL Impact Assessment / Resolution columns (itsm_tickets migration 0005).
    "impact": {"path": "impact", "kind": "choice", "nullable": False},
    "urgency": {"path": "urgency", "kind": "choice", "nullable": False},
    "resolution_code": {"path": "resolution_code", "kind": "choice", "nullable": True},
    "business_impact": {"path": "business_impact", "kind": "text", "nullable": False},
    "root_cause": {"path": "root_cause", "kind": "text", "nullable": False},
    "resolution_notes": {"path": "resolution_notes", "kind": "text", "nullable": False},
    "major_incident": {"path": "major_incident", "kind": "boolean", "nullable": True},
    "service_downtime": {"path": "service_downtime", "kind": "boolean", "nullable": True},
    "workaround_provided": {"path": "workaround_provided", "kind": "boolean", "nullable": True},
    "users_affected": {"path": "users_affected", "kind": "number", "nullable": True},
    # ITIL Problem columns (itsm_tickets migration 0010).
    "workaround_notes": {"path": "workaround_notes", "kind": "text", "nullable": False},
    "investigation_reason": {"path": "investigation_reason", "kind": "choice", "nullable": False},
    # The ticket body (richtext → text "contains"); no built-in equivalent.
    "description_html": {"path": "description_html", "kind": "text", "nullable": False},
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
PRIORITY_RANK = {"p1": 0, "p2": 1, "p3": 2, "p4": 3}

# UI column name -> safe DB ordering target (validated against ORDERING_FIELDS).
# People columns sort by the *display name* the cell renders (a `*_name` annotation
# in TicketViewSet.get_queryset), never by the raw FK id.
ORDERING_ALIASES = {
    "priority": "priority_rank",
    "status": "status__sort_order",
    "status_category": "status__category__sort_order",
    "assignee": "assignee_name",
    "requestor": "requestor_name",
    "assigned_group": "assigned_group__name",
    "project": "project__name",
    "created_by": "created_by_name",
    "updated_by": "updated_by_name",
    "type": "ticket_type__name",
    "created": "created_at",
    "updated": "updated_at",
}
# Allowed ordering targets after alias translation. `cf:<key>` custom-field columns
# are NOT here — they resolve per request to a `cf_sort_<n>` annotation that
# TicketViewSet appends to this list (see `_annotate_cf_ordering`).
ORDERING_FIELDS = [
    "created_at", "updated_at", "due_date", "resolved_at", "ticket_number", "summary",
    "priority_rank", "assignee_name", "requestor_name", "created_by_name",
    "updated_by_name", "assigned_group__name", "project__name", "status__sort_order",
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


def custom_field_payload(project, *, value_backed_only: bool = False) -> list[dict]:
    """Filter-field metadata for every custom field visible to `project`.

    Only fields **actually present** on this project are listed: its own fields plus
    the globals that apply to it (``applicable_only`` hides the ``applies_to``-tagged
    ITIL defs on project types outside their list — the same rule the Fields tab uses).

    A column-backed global whose key is already a **built-in** filter (``priority``,
    ``requestor``, ``assignee``, ``assigned_group``, ``source``, ``summary``) is skipped:
    it's the same underlying Ticket column as the Standard entry, so listing it again
    under "Custom fields" is a duplicate. The capability is NOT lost — the Standard
    field remains (and is the one the UI has always compiled correctly).

    ``value_backed_only`` narrows further to genuine value-backed custom fields —
    it drops every column-backed system/ITIL global (any field carrying
    ``config.maps_to``). Those store their value on a ``Ticket`` column, never a
    ``FieldValue``, so they already exist as built-in queue columns and would render
    blank if picked as a ``cf:`` column. Used by the project/helpdesk **Columns**
    editors; the queue **filter** picker keeps the rest (default ``False``).
    """
    from apps.itsm_core.services import fields as field_service

    out: list[dict] = []
    for fd in field_service.get_field_definitions(project, applicable_only=True):
        ft = fd.field_type
        if ft in NO_VALUE_TYPES:
            continue
        maps_to_cfg = (fd.config or {}).get("maps_to")
        if value_backed_only and maps_to_cfg:
            continue
        # Duplicate of a Standard filter on the same column → keep only the Standard one.
        if maps_to_cfg and fd.key in BUILTIN_TYPE:
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
        # Column-backed system field (`config.maps_to`): the value lives on the Ticket
        # column, so there is NEVER a FieldValue row for it. Flag it so the queue
        # column pickers can exclude it — as a `cf:` column it would render
        # permanently blank AND duplicate the equivalent built-in column
        # (Assigned Group / Assignee / Priority / Requestor / Description / ITIL…).
        maps_to = (fd.config or {}).get("maps_to")
        if maps_to:
            entry["maps_to"] = maps_to
        # Sortable as a queue column? Only a value-backed field of an orderable type
        # (`CF_SORTABLE_TYPES`) — the queue makes a `cf:` column header clickable iff
        # this key is published, and sends it back as `?ordering=cf:<key>`. A
        # `maps_to` field is excluded here because it can't be a `cf:` column at all.
        if not maps_to and ft in field_service.CF_SORTABLE_TYPES:
            entry["ordering_key"] = f"cf:{fd.key}"
        if ft in OPTION_TYPES:
            entry["options"] = option_metadata(fd)
        if ft == FieldType.GROUP_PICKER:
            entry["options_source"] = "groups"
        out.append(entry)
    return out


def column_cf_keys(projects) -> set[str]:
    """The `cf:<key>` columns a scope may actually RENDER — value-backed custom
    fields only. Excludes value-less types (attachment) and column-backed
    (`config.maps_to`) system fields, whose values live on the Ticket column and so
    would render a blank `cf:` column. Used by the queue-column write validators."""
    from apps.itsm_core.services import fields as field_service

    keys: set[str] = set()
    for project in projects:
        for fd in field_service.get_field_definitions(project, applicable_only=True):
            if fd.field_type in NO_VALUE_TYPES:
                continue
            if (fd.config or {}).get("maps_to"):
                continue
            keys.add(f"cf:{fd.key}")
    return keys


def builtin_field_payload() -> list[dict]:
    out = []
    for f in BUILTIN_FIELDS:
        entry = {**f, "operators": operators_for_key(f["key"]), "group": "Standard"}
        out.append(entry)
    return out


def filter_fields_payload(project, *, value_backed_only: bool = False) -> dict:
    """The full {fields, system_views} payload for GET /tickets/filter-fields/."""
    return {
        "fields": builtin_field_payload()
        + custom_field_payload(project, value_backed_only=value_backed_only),
        "system_views": SYSTEM_VIEWS,
    }


def filter_fields_payload_multi(projects, *, value_backed_only: bool = False) -> dict:
    """Filter registry for a COMBINED (cross-project) queue: builtin fields + the
    UNION of every scoped project's custom fields, deduped by ``cf:<key>``.

    Collisions (two projects defining the same key): the FIRST project's definition
    wins — matching ``query_builder._compile_custom``, which resolves a ``cf:<key>``
    condition against the lowest ``project_id``'s ``FieldDefinition``. Options are
    merged (union, deduped by value) for a same-key/same-type field; a
    same-key/**different-type** field is dropped from the union (it can't be compiled
    unambiguously in one cross-project query). Global fields (``project=null``) are
    returned by every project's payload, so the dedup collapses them to one entry.
    """
    seen: dict[str, dict] = {}
    for project in projects:
        for entry in custom_field_payload(project, value_backed_only=value_backed_only):
            key = entry["key"]
            prev = seen.get(key)
            if prev is None:
                seen[key] = entry
                continue
            if prev["type"] != entry["type"]:
                continue  # ambiguous across projects → keep first, skip this one
            if "options" in prev or "options" in entry:
                merged = {o["value"]: o for o in prev.get("options", [])}
                for o in entry.get("options", []):
                    merged.setdefault(o["value"], o)
                prev["options"] = list(merged.values())
    return {
        "fields": builtin_field_payload() + list(seen.values()),
        "system_views": SYSTEM_VIEWS,
    }
