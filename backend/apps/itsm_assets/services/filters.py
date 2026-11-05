"""Asset list filters, shared by the list, dashboard drill-through, report and export.

All filters are query params; ids may be comma-separated, and ``none`` matches an
empty value (e.g. ``location=none`` → assets without a location).
"""

from __future__ import annotations

import datetime as dt
import uuid

from django.db.models import Exists, OuterRef, Q

from ..models import AssetFieldValue, StateType
from .parsing import parse_date

# ?ordering= keys → ORM order. Anything else is ignored (never a 400).
ORDERING = {
    "asset_tag": "asset_tag",
    "name": "name",
    "category": "category__name",
    "sub_category": "sub_category__name",
    "status": "status__sort_order",
    "location": "location__name",
    "department": "department__name",
    "vendor": "vendor__name",
    "assigned_user": "assigned_user__full_name",
    "purchase_date": "purchase_date",
    "purchase_cost": "purchase_cost",
    "expiry_date": "expiry_date",
    "warranty_expiry_date": "warranty_expiry_date",
    "created_at": "created_at",
    "updated_at": "updated_at",
}
FK_FILTERS = {
    "category": "category_id",
    "sub_category": "sub_category_id",
    "status": "status_id",
    "location": "location_id",
    "department": "department_id",
    "vendor": "vendor_id",
    "assigned_user": "assigned_user_id",
    "import": "source_import_id",
}
WINDOW_DAYS = 30


def _ids(raw: str):
    vals, want_none = [], False
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        if part.lower() == "none":
            want_none = True
            continue
        try:
            vals.append(uuid.UUID(part) if len(part) > 12 else int(part))
        except (ValueError, TypeError):
            continue
    return vals, want_none


def apply_filters(qs, params, *, today: dt.date):
    for key, column in FK_FILTERS.items():
        raw = params.get(key)
        if not raw:
            continue
        ids, want_none = _ids(raw)
        cond = Q()
        if ids:
            cond |= Q(**{f"{column}__in": ids})
        if want_none:
            cond |= Q(**{f"{column}__isnull": True})
        qs = qs.filter(cond) if (ids or want_none) else qs.none()

    state = params.get("state_type")
    if state:
        states = [s for s in str(state).split(",") if s in StateType.values]
        if str(state) == "active":
            states = [StateType.AVAILABLE, StateType.IN_USE, StateType.MAINTENANCE]
        qs = qs.filter(status__state_type__in=states)

    soon = today + dt.timedelta(days=WINDOW_DAYS)
    warranty = params.get("warranty")
    if warranty == "expiring":
        qs = qs.filter(warranty_expiry_date__gte=today, warranty_expiry_date__lte=soon)
    elif warranty == "expired":
        qs = qs.filter(warranty_expiry_date__lt=today)
    elif warranty == "covered":
        qs = qs.filter(warranty_expiry_date__gte=today)
    elif warranty == "none":
        qs = qs.filter(warranty_expiry_date__isnull=True)

    expiry = params.get("expiry")
    if expiry == "expiring":
        qs = qs.filter(expiry_date__gte=today, expiry_date__lte=soon)
    elif expiry == "passed":
        qs = qs.filter(expiry_date__lt=today)
    elif expiry == "none":
        qs = qs.filter(expiry_date__isnull=True)

    d_from, _ = parse_date(params.get("purchased_from"))
    d_to, _ = parse_date(params.get("purchased_to"))
    if d_from:
        qs = qs.filter(purchase_date__gte=d_from)
    if d_to:
        qs = qs.filter(purchase_date__lte=d_to)

    search = (params.get("search") or "").strip()
    if search:
        detail_hit = AssetFieldValue.objects.filter(asset=OuterRef("pk"), value_text__icontains=search)
        qs = qs.filter(
            Q(name__icontains=search) | Q(asset_tag__icontains=search)
            | Q(assigned_user__full_name__icontains=search)
            | Q(assigned_user__username__icontains=search)
            | Exists(detail_hit)
        )
    return qs


def apply_ordering(qs, raw):
    order = []
    for part in str(raw or "").split(","):
        part = part.strip()
        desc = part.startswith("-")
        col = ORDERING.get(part.lstrip("-"))
        if col:
            order.append(f"-{col}" if desc else col)
    if not order:
        return qs.order_by("-created_at", "asset_tag")
    return qs.order_by(*order, "asset_tag")
