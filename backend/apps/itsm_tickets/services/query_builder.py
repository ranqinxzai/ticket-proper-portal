"""Translate a SavedFilter / ad-hoc `query_spec` (JSON) into a Django Q over Ticket.

Two spec shapes are supported and may be combined (AND-ed):

1. Legacy flat shape (kept for back-compat — dashboards widgets, bulk ops)::

     {"project": "<uuid>", "status": ["<uuid>"], "priority": ["high"],
      "assignee": "me" | "<uuid>" | null, "assignee_isnull": true,
      "text": "...", "created_after": "ISO", "custom_fields": {"<key>": "<value>"}}

2. Operator-based condition list (the JIRA-like filter engine)::

     {"match": "all" | "any",                 # default "all"
      "conditions": [
        {"field": "status", "op": "in", "value": ["<uuid>", ...]},
        {"field": "assignee", "op": "is_empty"},
        {"field": "priority", "op": "neq", "value": "low"},
        {"field": "created_at", "op": "between", "value": ["ISO", "ISO"]},
        {"field": "due_date", "op": "overdue"},
        {"field": "cf:<key>", "op": "eq", "value": "..."}   # custom field
      ]}

Field keys and operators are validated against ``filter_fields`` — only whitelisted
ORM paths are ever interpolated, so a client cannot probe arbitrary relations.
The helpdesk-scope clamp (``accessible_helpdesk_ids``) is ALWAYS AND-ed at the top
level, outside the ``match`` group, so a ``match:"any"`` spec can never OR past it.
"""

from __future__ import annotations

import functools
import operator as _op
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from . import filter_fields

# Max conditions honoured per spec (defensive cap; the rest are ignored).
MAX_CONDITIONS = 50

_NO_MATCH = object()  # sentinel: "me" with no authenticated user
_MATCH_NONE = Q(pk__in=[])   # always false (safe under AND and OR)
_MATCH_ALL = ~Q(pk__in=[])   # always true  (safe under AND and OR)


def build_q(query_spec: dict, *, user=None, accessible_helpdesk_ids=None,
            accessible_project_ids=None) -> Q:
    """Compile a query_spec to a Q over Ticket.

    ``accessible_helpdesk_ids`` is the helpdesk-scope clamp (see
    ``apps.itsm_helpdesks.services``): ``None`` ⇒ unrestricted (superuser / internal),
    a list ⇒ restrict to ``project__helpdesk_id__in`` (possibly empty ⇒ nothing).
    ``accessible_project_ids`` is the finer per-user project clamp (see
    ``apps.itsm_projects.services``): same ``None``/list contract, ANDed as
    ``project_id__in``. Every ticket-facing caller MUST pass BOTH so no shared path
    leaks across helpdesks or unassigned projects.
    """
    spec = query_spec or {}
    q = Q(is_deleted=False)

    if accessible_helpdesk_ids is not None:
        q &= Q(project__helpdesk_id__in=accessible_helpdesk_ids)
    if accessible_project_ids is not None:
        q &= Q(project_id__in=accessible_project_ids)

    # ── legacy flat keys (back-compat — FK values coerced so bad input can't 500) ─
    if spec.get("project") and (pid := _coerce_uuid(spec["project"])):
        q &= Q(project_id=pid)
    if spec.get("ticket_type") and (tid := _coerce_uuid(spec["ticket_type"])):
        q &= Q(ticket_type_id=tid)
    if spec.get("status") and (sids := [s for s in (_coerce_uuid(x) for x in _as_list(spec["status"])) if s]):
        q &= Q(status_id__in=sids)
    if spec.get("status_category"):
        q &= Q(status__category__key__in=_as_list(spec["status_category"]))
    if spec.get("priority"):
        q &= Q(priority__in=_as_list(spec["priority"]))
    if spec.get("assigned_group") and (gid := _coerce_uuid(spec["assigned_group"])):
        q &= Q(assigned_group_id=gid)

    if spec.get("assignee_isnull"):
        q &= Q(assignee__isnull=True)
    elif spec.get("assignee"):
        aid = _coerce_user(spec["assignee"], user)
        q &= Q(assignee_id=aid) if aid is not None else _MATCH_NONE

    if spec.get("text"):
        t = spec["text"]
        q &= (Q(summary__icontains=t) | Q(ticket_number__icontains=t)
              | Q(description_text__icontains=t))

    if spec.get("created_after") and (ca := _parse_dt(spec["created_after"])):
        q &= Q(created_at__gte=ca)
    if spec.get("created_before") and (cb := _parse_dt(spec["created_before"], end=True)):
        q &= Q(created_at__lte=cb)

    for fkey, val in (spec.get("custom_fields") or {}).items():
        q &= Q(field_values__field__key=fkey, field_values__value_text=str(val))

    # ── operator-based conditions (the filter engine) ────────────────────────
    conds = spec.get("conditions") or []
    if conds:
        match = "any" if spec.get("match") == "any" else "all"
        sub = _compile_conditions(conds[:MAX_CONDITIONS], match, user)
        if sub is not None:
            q &= sub  # clamp stays outside this group

    return q


def filtered_tickets(query_spec: dict, *, user=None, accessible_helpdesk_ids=None,
                     accessible_project_ids=None):
    from apps.itsm_tickets.models import Ticket

    return Ticket.objects.filter(
        build_q(query_spec, user=user, accessible_helpdesk_ids=accessible_helpdesk_ids,
                accessible_project_ids=accessible_project_ids)
    ).distinct()


# ── condition compiler ───────────────────────────────────────────────────────

def _compile_conditions(conds, match, user) -> Q | None:
    qs = []
    for cond in conds:
        if not isinstance(cond, dict):
            continue
        q = _compile_condition(cond, user)
        if q is not None:
            qs.append(q)
    if not qs:
        return None
    combiner = _op.or_ if match == "any" else _op.and_
    return functools.reduce(combiner, qs)


def _compile_condition(cond, user) -> Q | None:
    field = cond.get("field")
    op = cond.get("op")
    if not field or not isinstance(field, str) or not op or not isinstance(op, str):
        return None
    if field.startswith("cf:"):
        return _compile_custom(field[3:], op, cond.get("value"), user)
    meta = filter_fields.BUILTIN_COMPILE.get(field)
    if meta is None:
        return None
    if op not in filter_fields.operators_for_key(field):
        return None
    ftype = filter_fields.BUILTIN_TYPE[field]
    return _compile_builtin(field, meta, ftype, op, cond.get("value"), user)


def _compile_builtin(field, meta, ftype, op, value, user) -> Q | None:
    path = meta["path"]
    kind = meta["kind"]
    is_user = meta.get("user", False)
    now = timezone.now()

    if op == "is_empty":
        if kind == "text":
            return Q(**{f"{path}__exact": ""}) | Q(**{f"{path}__isnull": True})
        return Q(**{f"{path}__isnull": True})
    if op == "is_not_empty":
        if kind == "text":
            return ~(Q(**{f"{path}__exact": ""}) | Q(**{f"{path}__isnull": True}))
        return Q(**{f"{path}__isnull": False})

    if field == "due_date" and op == "overdue":
        return Q(due_date__lt=now, due_date__isnull=False) & ~Q(status__category__key="done")
    if field == "due_date" and op == "due_today":
        start, end = _relative_window("today", now)
        return Q(due_date__gte=start, due_date__lt=end)

    if kind == "date":
        return _date_q(path, op, value, now)

    if kind == "text":
        if value in (None, ""):
            return None
        if op == "contains":
            return Q(**{f"{path}__icontains": value})
        if op == "not_contains":
            return ~Q(**{f"{path}__icontains": value})
        if op == "eq":
            return Q(**{f"{path}__iexact": value})
        if op == "neq":
            return ~Q(**{f"{path}__iexact": value})
        return None

    # discrete fk / choice — values are coerced so malformed input drops cleanly
    # (a bad UUID/int would otherwise raise at query compile → 500).
    if is_user:
        if op in ("eq", "neq"):
            cid = _coerce_user(value, user)
            if cid is None:
                return _MATCH_NONE if op == "eq" else _MATCH_ALL
            q = Q(**{path: cid})
            return ~q if op == "neq" else q
        if op in ("in", "not_in"):
            vals = [c for c in (_coerce_user(x, user) for x in _as_list(value)) if c is not None]
            if not vals:
                return _MATCH_NONE if op == "in" else _MATCH_ALL
            q = Q(**{f"{path}__in": vals})
            return ~q if op == "not_in" else q
        return None

    coerce = _coerce_uuid if kind == "fk" else _coerce_choice
    if op == "eq":
        cv = coerce(value)
        return Q(**{path: cv}) if cv is not None else None
    if op == "neq":
        cv = coerce(value)
        return ~Q(**{path: cv}) if cv is not None else None
    if op == "in":
        vals = [c for c in (coerce(v) for v in _as_list(value)) if c is not None]
        return Q(**{f"{path}__in": vals}) if vals else _MATCH_NONE
    if op == "not_in":
        vals = [c for c in (coerce(v) for v in _as_list(value)) if c is not None]
        return ~Q(**{f"{path}__in": vals}) if vals else _MATCH_ALL
    return None


def _compile_custom(key, op, value, user) -> Q | None:
    from apps.itsm_core.models import FieldDefinition, FieldValue

    fd = (FieldDefinition.objects.filter(key=key, is_deleted=False)
          .order_by("project_id").first())
    if fd is None:
        return None
    ft = fd.field_type
    col = filter_fields.FIELDVALUE_COLUMN.get(ft)
    ftype = filter_fields.FILTER_TYPE_FROM_FIELDTYPE.get(ft)
    if col is None or ftype is None:
        return None
    if op not in filter_fields.OPERATORS_BY_TYPE.get(ftype, []):
        return None

    base = FieldValue.objects.filter(ticket=OuterRef("pk"), field__key=key, is_deleted=False)
    now = timezone.now()

    if op in ("is_empty", "is_not_empty"):
        if col == "value_text":
            present = base.exclude(value_text="")
        elif col == "value_json":
            present = base.exclude(value_json=[]).exclude(value_json__isnull=True)
        else:
            present = base.filter(**{f"{col}__isnull": False})
        return ~_exists(present) if op == "is_empty" else _exists(present)

    if ftype == "boolean":
        if op == "is_true":
            return _exists(base.filter(value_bool=True))
        if op == "is_false":
            return _exists(base.filter(value_bool=False))
        return None

    if ftype == "date":
        dq = _date_q(col, op, value, now)
        return _exists(base.filter(dq)) if dq is not None else None

    if ftype == "number":
        return _custom_number(base, op, value)

    if ftype == "text":
        if value in (None, ""):
            return None
        if op == "contains":
            return _exists(base.filter(value_text__icontains=value))
        if op == "not_contains":
            return ~_exists(base.filter(value_text__icontains=value))
        if op == "eq":
            return _exists(base.filter(value_text__iexact=value))
        if op == "neq":
            return ~_exists(base.filter(value_text__iexact=value))
        return None

    if ftype == "multiselect":
        vals = [v for v in _as_list(value) if v not in (None, "")]
        if not vals:
            return _MATCH_NONE if op == "in" else _MATCH_ALL
        sub = functools.reduce(_op.or_, (Q(value_json__contains=[v]) for v in vals))
        if op == "in":
            return _exists(base.filter(sub))
        if op == "not_in":
            return ~_exists(base.filter(sub))
        return None

    if ftype == "user":
        if op in ("eq", "neq"):
            cid = _coerce_user(value, user)
            if cid is None:
                return _MATCH_NONE if op == "eq" else _MATCH_ALL
            ex = _exists(base.filter(value_user_id=cid))
            return ~ex if op == "neq" else ex
        if op in ("in", "not_in"):
            vals = [c for c in (_coerce_user(x, user) for x in _as_list(value)) if c is not None]
            if not vals:
                return _MATCH_NONE if op == "in" else _MATCH_ALL
            ex = _exists(base.filter(value_user_id__in=vals))
            return ~ex if op == "not_in" else ex
        return None

    if ftype == "select":
        if op == "eq":
            return _exists(base.filter(value_text=value)) if value not in (None, "") else None
        if op == "neq":
            return ~_exists(base.filter(value_text=value)) if value not in (None, "") else None
        if op == "in":
            vals = [v for v in _as_list(value) if v not in (None, "")]
            return _exists(base.filter(value_text__in=vals)) if vals else _MATCH_NONE
        if op == "not_in":
            vals = [v for v in _as_list(value) if v not in (None, "")]
            return ~_exists(base.filter(value_text__in=vals)) if vals else _MATCH_ALL
        return None
    return None


def _custom_number(base, op, value) -> Q | None:
    def num(v):
        try:
            return Decimal(str(v))
        except (InvalidOperation, TypeError, ValueError):
            return None

    if op == "between":
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            return None
        a, b = num(value[0]), num(value[1])
        q = Q()
        if a is not None:
            q &= Q(value_number__gte=a)
        if b is not None:
            q &= Q(value_number__lte=b)
        return _exists(base.filter(q)) if (a is not None or b is not None) else None

    n = num(value)
    if n is None:
        return None
    lookup = {
        "eq": "value_number", "neq": "value_number",
        "gt": "value_number__gt", "gte": "value_number__gte",
        "lt": "value_number__lt", "lte": "value_number__lte",
    }.get(op)
    if lookup is None:
        return None
    ex = _exists(base.filter(**{lookup: n}))
    return ~ex if op == "neq" else ex


# ── shared helpers ───────────────────────────────────────────────────────────

def _exists(qs) -> Q:
    """Wrap an Exists subquery in a Q so it composes with &/| and ~ in a Q tree."""
    return Q(Exists(qs))


def _resolve_user_value(value, user):
    if value == "me":
        if user is not None and getattr(user, "is_authenticated", False):
            return user.id
        return _NO_MATCH
    return value


def _as_list(value):
    """Normalize a condition value to a list (a stray scalar string would otherwise
    iterate by character in `in`/`not_in`)."""
    if isinstance(value, list):
        return value
    return [] if value in (None, "") else [value]


def _coerce_uuid(value):
    """Validate a UUID-PK value; return the normalized string or None. Dropping
    unparseable ids keeps a bad ?q from raising ValidationError at query compile."""
    if value in (None, ""):
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def _coerce_user_id(value):
    """Validate an integer (User) PK; return the int or None for bad input."""
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _coerce_choice(value):
    """Choice / string-PK values pass through unchanged (drop blanks)."""
    return None if value in (None, "") else value


def _coerce_user(value, user):
    """Resolve 'me' then int-coerce; returns None if unresolvable/invalid."""
    resolved = _resolve_user_value(value, user)
    return None if resolved is _NO_MATCH else _coerce_user_id(resolved)


def _aware(dt):
    if dt is None:
        return None
    return timezone.make_aware(dt, timezone.get_current_timezone()) if timezone.is_naive(dt) else dt


def _parse_dt(value, *, end=False):
    """Parse an ISO datetime/date to an aware datetime. Date-only → day start/end."""
    if value in (None, ""):
        return None
    dt = parse_datetime(str(value))
    if dt is not None:
        return _aware(dt)
    d = parse_date(str(value))
    if d is None:
        return None
    return _aware(datetime.combine(d, time.max if end else time.min))


def _day_bounds(value):
    start = _parse_dt(value)
    if start is None:
        return None, None
    local = timezone.localtime(start, timezone.get_current_timezone())
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start, day_start + timedelta(days=1)


def _relative_window(token, now):
    local = timezone.localtime(now, timezone.get_current_timezone())
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if token == "today":
        return day_start, day_start + timedelta(days=1)
    if token == "yesterday":
        return day_start - timedelta(days=1), day_start
    if token == "last_7_days":
        return now - timedelta(days=7), None
    if token == "last_30_days":
        return now - timedelta(days=30), None
    if token == "this_week":
        week_start = day_start - timedelta(days=day_start.weekday())  # Monday
        return week_start, week_start + timedelta(days=7)
    if token == "this_month":
        month_start = day_start.replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)
        return month_start, next_month
    return None, None


def _date_q(path, op, value, now) -> Q | None:
    if op == "before":
        dt = _parse_dt(value)
        return Q(**{f"{path}__lt": dt}) if dt else None
    if op == "after":
        dt = _parse_dt(value, end=True)
        return Q(**{f"{path}__gt": dt}) if dt else None
    if op == "on":
        start, end = _day_bounds(value)
        return Q(**{f"{path}__gte": start, f"{path}__lt": end}) if start else None
    if op == "between":
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            return None
        start, end = _parse_dt(value[0]), _parse_dt(value[1], end=True)
        q = Q()
        if start:
            q &= Q(**{f"{path}__gte": start})
        if end:
            q &= Q(**{f"{path}__lte": end})
        return q if (start or end) else None
    if op in ("today", "yesterday", "last_7_days", "last_30_days", "this_week", "this_month"):
        start, end = _relative_window(op, now)
        if start is None:
            return None
        q = Q(**{f"{path}__gte": start})
        if end is not None:
            q &= Q(**{f"{path}__lt": end})
        return q
    return None
