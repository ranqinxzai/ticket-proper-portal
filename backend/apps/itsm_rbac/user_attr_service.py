"""Custom user-attribute engine — typed read/write of per-user attribute values.

A trimmed cousin of ``itsm_core.services.fields`` (the ticket field engine):
one typed :class:`UserAttributeValue` row per (user, attribute), coerced to the
right column by attribute type, plus required-validation and roster filtering.
No layouts/regions/cascade/portal — a flat directory-field model.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db.models import Exists, OuterRef
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from .models import (
    USER_ATTR_MULTI_TYPES,
    USER_ATTR_OPTION_TYPES,
    UserAttributeDefinition,
    UserAttributeType,
    UserAttributeValue,
)

_EMPTY = {
    "value_text": "",
    "value_number": None,
    "value_date": None,
    "value_bool": None,
    "value_json": None,
}

_TRUE = {"1", "true", "yes", "on"}


def _parse_dt(raw):
    """Accept an ISO datetime OR a bare ``YYYY-MM-DD`` → an aware datetime."""
    if hasattr(raw, "isoformat") and not isinstance(raw, str):
        dt = raw
    else:
        s = str(raw)
        dt = parse_datetime(s)
        if dt is None:
            d = parse_date(s)
            if d is None:
                return None
            dt = timezone.datetime(d.year, d.month, d.day)
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _coerce(defn: UserAttributeDefinition, raw) -> dict:
    """Map a raw input to the typed ``value_*`` columns for this attribute type."""
    t = defn.attr_type
    kw = dict(_EMPTY)
    if raw in (None, "", []):
        return kw
    if t in (UserAttributeType.TEXT, UserAttributeType.DROPDOWN):
        kw["value_text"] = str(raw)
    elif t == UserAttributeType.NUMBER:
        try:
            kw["value_number"] = Decimal(str(raw))
        except (InvalidOperation, ValueError, TypeError):
            kw["value_number"] = None
    elif t == UserAttributeType.DATE:
        kw["value_date"] = _parse_dt(raw)
    elif t == UserAttributeType.CHECKBOX:
        kw["value_bool"] = raw.lower() in _TRUE if isinstance(raw, str) else bool(raw)
    elif t in USER_ATTR_MULTI_TYPES:
        kw["value_json"] = raw if isinstance(raw, list) else [raw]
    else:
        kw["value_text"] = str(raw)
    return kw


def _serialize(v: UserAttributeValue):
    """A ``UserAttributeValue`` row → a JSON-safe value (inverse of ``_coerce``)."""
    t = v.attribute.attr_type
    if t in (UserAttributeType.TEXT, UserAttributeType.DROPDOWN):
        return v.value_text
    if t == UserAttributeType.NUMBER:
        return float(v.value_number) if v.value_number is not None else None
    if t == UserAttributeType.DATE:
        return v.value_date.isoformat() if v.value_date else None
    if t == UserAttributeType.CHECKBOX:
        return v.value_bool
    if t in USER_ATTR_MULTI_TYPES:
        return v.value_json or []
    return v.value_text


def get_definitions(*, active_only: bool = True):
    qs = UserAttributeDefinition.objects.filter(is_deleted=False)
    if active_only:
        qs = qs.filter(is_active=True)
    return qs.order_by("sort_order", "name")


def get_values(user) -> dict:
    """{attribute_key: value} for one user (issues its own query)."""
    rows = (
        UserAttributeValue.objects.filter(user=user)
        .select_related("attribute")
    )
    return {r.attribute.key: _serialize(r) for r in rows}


def values_from_prefetched(user) -> dict:
    """{attribute_key: value} read from a prefetched ``itsm_attribute_values`` cache.

    Used by the roster serializer to avoid an N+1 — the viewset prefetches the
    live values with their attribute select_related.
    """
    out = {}
    for r in user.itsm_attribute_values.all():
        if r.is_deleted:
            continue
        out[r.attribute.key] = _serialize(r)
    return out


def set_values(user, values: dict):
    """Upsert ``{attribute_key: raw}`` for a user. Unknown/inactive keys skipped."""
    if not values:
        return
    defs = {d.key: d for d in get_definitions(active_only=True)}
    for key, raw in values.items():
        defn = defs.get(key)
        if defn is None:
            continue
        kw = _coerce(defn, raw)
        # all_objects so we revive a previously soft-deleted row instead of
        # colliding with the (user, attribute) unique constraint.
        obj, _ = UserAttributeValue.all_objects.get_or_create(user=user, attribute=defn)
        for attr, val in kw.items():
            setattr(obj, attr, val)
        obj.is_deleted = False
        obj.deleted_at = None
        obj.save()


def validate_required(values: dict) -> dict:
    """{attribute_key: [msg]} for required attributes missing in ``values``.

    A required option attribute with no active options is skipped — an
    unconfigured dropdown can't be satisfied and must not deadlock creation
    (mirrors the ticket field engine's ``validate_required``).
    """
    errors = {}
    for defn in get_definitions(active_only=True).filter(is_required=True):
        if defn.attr_type in USER_ATTR_OPTION_TYPES and not defn.options.filter(
            is_active=True, is_deleted=False
        ).exists():
            continue
        if values.get(defn.key) in (None, "", []):
            errors[defn.key] = ["This field is required."]
    return errors


def apply_filters(qs, params):
    """Clamp a ``User`` queryset by ``attr_<key>=value`` query params (AND-ed)."""
    for defn in get_definitions(active_only=True):
        raw = params.get(f"attr_{defn.key}")
        if raw in (None, ""):
            continue
        sub = UserAttributeValue.objects.filter(
            attribute=defn, user=OuterRef("pk")
        )
        t = defn.attr_type
        if t == UserAttributeType.MULTISELECT:
            sub = sub.filter(value_json__contains=[raw])
        elif t == UserAttributeType.DROPDOWN:
            sub = sub.filter(value_text=raw)
        elif t == UserAttributeType.TEXT:
            sub = sub.filter(value_text__icontains=raw)
        elif t == UserAttributeType.NUMBER:
            try:
                sub = sub.filter(value_number=Decimal(str(raw)))
            except (InvalidOperation, ValueError, TypeError):
                continue
        elif t == UserAttributeType.CHECKBOX:
            sub = sub.filter(value_bool=str(raw).lower() in _TRUE)
        elif t == UserAttributeType.DATE:
            d = parse_date(str(raw))
            if d is None:
                continue
            sub = sub.filter(value_date__date=d)
        qs = qs.filter(Exists(sub))
    return qs


def filter_fields() -> list:
    """Attribute metadata for the roster filter UI: [{key,name,type,options?}]."""
    out = []
    for defn in get_definitions(active_only=True):
        meta = {"key": defn.key, "name": defn.name, "type": defn.attr_type}
        if defn.attr_type in USER_ATTR_OPTION_TYPES:
            meta["options"] = [
                {"value": o.value, "label": o.label}
                for o in defn.options.filter(is_active=True, is_deleted=False).order_by(
                    "sort_order", "id"
                )
            ]
        out.append(meta)
    return out
