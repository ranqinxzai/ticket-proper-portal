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

from django.db.models import Q

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


# A saved layout is the FULL ordered column list: a plain key is visible, a key
# prefixed with ``HIDDEN_COLUMN_PREFIX`` is hidden but keeps its place (so an
# unticked column comes back where it was). Older layouts hold only visible keys
# and mean exactly what they always did. Mirrors ``queue-columns.tsx``.
HIDDEN_COLUMN_PREFIX = "!"


def clean_queue_columns(value, *, valid_cf: set[str] | None = None) -> list[str]:
    """Narrow a saved column layout to real columns: a known built-in, or a
    ``cf:<key>`` custom column — visible, or hidden (``!``-prefixed). When
    ``valid_cf`` is given (the set of ``cf:<key>`` a scope actually defines),
    unknown/stale custom columns are dropped too, hidden ones included. Duplicates
    (by column key, visible or hidden — first one wins) are removed, order
    preserved. A layout with no visible column left is ``[]`` (= use the default)."""
    if not isinstance(value, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, str):
            continue
        hidden = raw.startswith(HIDDEN_COLUMN_PREFIX)
        key = raw[len(HIDDEN_COLUMN_PREFIX):] if hidden else raw
        if key in seen:
            continue
        if key in QUEUE_COLUMN_KEYS or (
            key.startswith("cf:") and (valid_cf is None or key in valid_cf)
        ):
            seen.add(key)
            cleaned.append(HIDDEN_COLUMN_PREFIX + key if hidden else key)
    if not any(not k.startswith(HIDDEN_COLUMN_PREFIX) for k in cleaned):
        return []
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

# Column-backed fields that may ALSO be picked as a ``cf:<key>`` queue column: the
# ITIL set has no built-in queue column, so the cf: column is its only one. The cell
# is read straight off the Ticket column (``custom_column_values``) and sorted by it
# (``TicketViewSet._annotate_cf_ordering``). The ticket body stays out — a rich-text
# blob is no table cell. Keyed by the ``maps_to`` column name (== the field key).
COLUMN_BACKED_CF: frozenset[str] = frozenset(MAPPED_COMPILE) - {"description_html"}


def is_column_eligible(fd) -> bool:
    """Can this field definition be a ``cf:`` queue column? Value-backed fields of a
    valued type, plus the column-backed ITIL fields in ``COLUMN_BACKED_CF``."""
    if fd.field_type in NO_VALUE_TYPES:
        return False
    maps_to = (fd.config or {}).get("maps_to")
    return not maps_to or maps_to in COLUMN_BACKED_CF


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


def clean_disabled_view_keys(value) -> list[str]:
    """Admin-hidden system views for a queue dropdown (``Project.disabled_view_keys``
    / ``Helpdesk.combined_disabled_view_keys``): keep only real system-view keys,
    order preserved, no duplicates. "all" can never be disabled."""
    valid = {v["key"] for v in SYSTEM_VIEWS} - {"all"}
    seen: list[str] = []
    for k in value or []:
        if k in valid and k not in seen:
            seen.append(k)
    return seen


def clean_default_view_key(value, visible: Q) -> str:
    """An admin default queue view (``Project.default_view_key`` /
    ``Helpdesk.combined_default_view_key``): a known system view key, or a
    ``saved:<uuid>`` reference to a live **shared** SavedFilter matching ``visible``
    (the scope every agent's queue can resolve). Anything else — an unknown key, a
    deleted/personal filter, one from another scope — falls back to blank so the
    queue resolves the product default rather than a dangling reference."""
    import uuid

    value = (value or "").strip()
    if not value:
        return ""
    if value in {v["key"] for v in SYSTEM_VIEWS}:
        return value
    if value.startswith("saved:"):
        from apps.itsm_dashboards.models import SavedFilter

        raw = value[len("saved:"):]
        try:
            uuid.UUID(raw)
        except ValueError:
            return ""
        if SavedFilter.objects.filter(visible, pk=raw, is_deleted=False, is_shared=True).exists():
            return value
    return ""


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

    ``value_backed_only`` narrows further to the fields that can be a ``cf:`` queue
    column (``is_column_eligible``): value-backed custom fields plus the column-backed
    ITIL fields (``COLUMN_BACKED_CF``), which have no built-in column of their own.
    Other column-backed globals (Description, …) are dropped. Used by the
    project/helpdesk **Columns** editors; the queue **filter** picker keeps the rest
    (default ``False``).
    """
    from apps.itsm_core.services import fields as field_service

    out: list[dict] = []
    for fd in field_service.get_field_definitions(project, applicable_only=True):
        ft = fd.field_type
        if ft in NO_VALUE_TYPES:
            continue
        maps_to_cfg = (fd.config or {}).get("maps_to")
        column = is_column_eligible(fd)
        if value_backed_only and not column:
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
        # column, never a FieldValue row. `column` tells the queue column pickers
        # whether it can still be a `cf:` column (the ITIL set — read off the Ticket
        # column) or not (Description …).
        maps_to = (fd.config or {}).get("maps_to")
        if maps_to:
            entry["maps_to"] = maps_to
        if column:
            entry["column"] = True
        # Sortable as a queue column? A column-eligible field of an orderable type
        # (`CF_SORTABLE_TYPES`) — the queue makes a `cf:` column header clickable iff
        # this key is published, and sends it back as `?ordering=cf:<key>`.
        if column and ft in field_service.CF_SORTABLE_TYPES:
            entry["ordering_key"] = f"cf:{fd.key}"
        if ft in OPTION_TYPES:
            entry["options"] = option_metadata(fd)
        if ft == FieldType.GROUP_PICKER:
            entry["options_source"] = "groups"
        out.append(entry)
    return out


def column_cf_keys(projects) -> set[str]:
    """The `cf:<key>` columns a scope may actually RENDER (`is_column_eligible`):
    value-backed custom fields plus the column-backed ITIL fields. Excludes
    value-less types (attachment) and other column-backed system fields
    (Description …). Used by the queue-column write validators."""
    from apps.itsm_core.services import fields as field_service

    keys: set[str] = set()
    for project in projects:
        for fd in field_service.get_field_definitions(project, applicable_only=True):
            if is_column_eligible(fd):
                keys.add(f"cf:{fd.key}")
    return keys


def builtin_field_payload() -> list[dict]:
    out = []
    for f in BUILTIN_FIELDS:
        entry = {**f, "operators": operators_for_key(f["key"]), "group": "Standard"}
        out.append(entry)
    return out


def _project_workflow_ids(project_ids) -> tuple[set, set]:
    """(default workflow ids, every workflow id in use) for these projects — the
    default workflows plus the distinct ``Ticket.workflow`` of their live tickets
    (rule 10: tickets keep the workflow they were created on, e.g. after "Make a copy
    for this project")."""
    from apps.itsm_projects.models import Project
    from apps.itsm_tickets.models import Ticket

    defaults = {w for w in Project.objects.filter(pk__in=project_ids)
                .values_list("default_workflow_id", flat=True) if w}
    used = set(Ticket.objects.filter(project_id__in=project_ids)
               .values_list("workflow_id", flat=True).distinct())
    return defaults, defaults | used


def status_options_for_project(project) -> list[dict]:
    """Status filter options for ONE project: statuses of every workflow its tickets
    use (+ any status a live ticket sits in, even a soft-deleted one), deduped by
    ``key``. The default workflow's status wins (label/colour/value), then the other
    workflows in sort order. ``status_lineage_ids`` makes the one value match every
    same-key status, so pre-copy tickets still filter."""
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.models import Status

    pid = getattr(project, "pk", project)
    defaults, used = _project_workflow_ids([pid])
    held = set(Ticket.objects.filter(project_id=pid).values_list("status_id", flat=True).distinct())
    rows = (Status.all_objects.filter(workflow_id__in=used)
            .filter(Q(is_deleted=False) | Q(pk__in=held))
            .order_by("sort_order", "id"))
    rows = sorted(rows, key=lambda s: (s.workflow_id not in defaults, s.sort_order))
    seen: dict[str, dict] = {}
    for st in rows:
        if st.key not in seen:
            seen[st.key] = {"value": str(st.id), "label": st.name, "color": st.color or None,
                            "aliases": []}
        else:
            # Same-key status ids of other (e.g. pre-copy) workflows: a saved filter
            # holding one still resolves its chip label + checked state client-side.
            seen[st.key]["aliases"].append(str(st.id))
    return list(seen.values())


def status_lineage_ids(ids) -> list[str]:
    """Expand picked status ids to every status with the same KEY in the workflows of
    the same "lineage" — the projects using the picked status's workflow (as default
    or via their tickets) and every workflow those projects use. An uncloned shared
    workflow resolves to itself (no behaviour change); Incident "new" and Request
    "new" are never merged unless one project's tickets span both workflows. Used by
    ``query_builder`` for the ``status`` filter (and so by automation conditions)."""
    from apps.itsm_projects.models import Project
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.models import Status

    ids = [str(i) for i in ids if i]
    if not ids:
        return ids
    picked = list(Status.all_objects.filter(pk__in=ids).values_list("key", "workflow_id"))
    if not picked:
        return ids
    out = set(ids)
    for key, wf_id in set(picked):
        pids = set(Project.objects.filter(default_workflow_id=wf_id).values_list("id", flat=True))
        pids |= set(Ticket.objects.filter(workflow_id=wf_id).values_list("project_id", flat=True).distinct())
        if not pids:
            continue
        _, wfs = _project_workflow_ids(pids)
        wfs.add(wf_id)
        out |= {str(i) for i in Status.all_objects.filter(workflow_id__in=wfs, key=key)
                .values_list("id", flat=True)}
    return sorted(out)


def filter_fields_payload(project, *, value_backed_only: bool = False) -> dict:
    """The full {fields, system_views} payload for GET /tickets/filter-fields/.

    The ``status`` field carries inline ``options`` = the statuses of every workflow
    the project's tickets use, deduped by key (default workflow wins) — so tickets
    left on a pre-copy workflow stay filterable (the client prefers inline options)."""
    fields = builtin_field_payload()
    if project:
        status_opts = status_options_for_project(project)
        for f in fields:
            if f["key"] == "status" and status_opts:
                f["options"] = status_opts
    return {
        "fields": fields + custom_field_payload(project, value_backed_only=value_backed_only),
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
