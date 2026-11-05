"""Asset Dashboard numbers and the Asset Report's group-by summary."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.db.models import Count, Sum

from ..models import ACTIVE_STATE_TYPES, AssetStatus, StateType
from .asset_service import user_label
from .filters import WINDOW_DAYS

TOP_N = 10

# group_by key → (id column, label column, label for "no value")
GROUPS: dict[str, tuple[str, str | None, str]] = {
    "category": ("category_id", "category__name", "—"),
    "sub_category": ("sub_category_id", "sub_category__name", "No sub-category"),
    "status": ("status_id", "status__name", "—"),
    "state_type": ("status__state_type", None, "—"),
    "location": ("location_id", "location__name", "No location"),
    "department": ("department_id", "department__name", "No department"),
    "vendor": ("vendor_id", "vendor__name", "No vendor"),
    "assigned_user": ("assigned_user_id", None, "Not allotted to a user"),
}
STATE_LABELS = dict(StateType.choices)


def _money(v) -> str:
    return f"{(v or Decimal('0')):.2f}"


def _grouped(qs, group_by: str, *, limit=None):
    id_col, label_col, none_label = GROUPS[group_by]
    cols = [id_col] + ([label_col] if label_col else [])
    if group_by == "assigned_user":
        cols += ["assigned_user__full_name", "assigned_user__username"]
    if group_by == "status":
        cols += ["status__color", "status__state_type", "status__sort_order"]
    rows = list(qs.values(*cols).annotate(n=Count("id"), cost=Sum("purchase_cost")).order_by("-n"))
    if group_by == "status":
        rows.sort(key=lambda r: (r["status__sort_order"] or 0))
    out = []
    for r in rows:
        key = r[id_col]
        if group_by == "state_type":
            label = STATE_LABELS.get(key, key or none_label)
        elif group_by == "assigned_user":
            label = ((r["assigned_user__full_name"] or "").strip() or r["assigned_user__username"]
                     or none_label) if key else none_label
        else:
            label = r.get(label_col) or none_label
        row = {"key": str(key) if key is not None else "none", "label": label,
               "count": r["n"], "cost": _money(r["cost"])}
        if group_by == "status":
            row["color"] = r["status__color"]
            row["state_type"] = r["status__state_type"]
        out.append(row)
    if limit and len(out) > limit:
        rest = out[limit:]
        out = out[:limit] + [{
            "key": "other", "label": f"{len(rest)} more", "count": sum(r["count"] for r in rest),
            "cost": _money(sum(Decimal(r["cost"]) for r in rest)),
        }]
    return out


def dashboard(qs, *, today: dt.date) -> dict:
    qs = qs.order_by()  # an explicit ordering would leak into the GROUP BY
    soon = today + dt.timedelta(days=WINDOW_DAYS)
    active = qs.filter(status__state_type__in=ACTIVE_STATE_TYPES)
    by_state = {r["status__state_type"]: r["n"] for r in
                qs.values("status__state_type").annotate(n=Count("id"))}
    warranty_list = (
        active.filter(warranty_expiry_date__gte=today, warranty_expiry_date__lte=soon)
        .select_related("assigned_user", "category", "status")
        .order_by("warranty_expiry_date", "asset_tag")[:TOP_N]
    )
    recent = qs.select_related("category", "status").order_by("-created_at")[:5]
    return {
        "today": today.isoformat(),
        "window_days": WINDOW_DAYS,
        "total": qs.count(),
        "active": active.count(),
        "active_cost": _money(active.aggregate(s=Sum("purchase_cost"))["s"]),
        "by_state_type": [
            {"key": s.value, "label": s.label, "count": by_state.get(s.value, 0)} for s in StateType
        ],
        "warranty_expiring": active.filter(
            warranty_expiry_date__gte=today, warranty_expiry_date__lte=soon).count(),
        "out_of_warranty": active.filter(warranty_expiry_date__lt=today).count(),
        "expiring": active.filter(expiry_date__gte=today, expiry_date__lte=soon).count(),
        "by_category": _grouped(qs, "category", limit=TOP_N),
        "by_status": _grouped(qs, "status"),
        "by_location": _grouped(qs, "location", limit=TOP_N),
        "by_department": _grouped(qs, "department", limit=TOP_N),
        "warranty_ending": [
            {"id": str(a.id), "asset_tag": a.asset_tag, "name": a.name,
             "category": a.category.name, "status": a.status.name,
             "warranty_expiry_date": a.warranty_expiry_date.isoformat(),
             "assigned_user": user_label(a.assigned_user) or None}
            for a in warranty_list
        ],
        "recent": [
            {"id": str(a.id), "asset_tag": a.asset_tag, "name": a.name,
             "category": a.category.name, "status": a.status.name,
             "status_color": a.status.color, "created_at": a.created_at.isoformat()}
            for a in recent
        ],
        "has_statuses": AssetStatus.objects.exists(),
    }


def report(qs, group_by: str) -> dict:
    if group_by not in GROUPS:
        group_by = "category"
    rows = _grouped(qs.order_by(), group_by)
    total_count = sum(r["count"] for r in rows)
    total_cost = sum(Decimal(r["cost"]) for r in rows)
    for r in rows:
        r["percent"] = round(100.0 * r["count"] / total_count, 1) if total_count else 0.0
    return {"group_by": group_by, "rows": rows,
            "total": {"count": total_count, "cost": _money(total_cost)}}
