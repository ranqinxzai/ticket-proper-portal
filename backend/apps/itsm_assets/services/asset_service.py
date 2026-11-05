"""The single write path for assets: validation, tags, detail values, history, expiry.

ViewSets and the Excel import both go through here (coding rule 4). History rows
(``AssetEvent``) are written explicitly in the same transaction (rule 5) — a rolled-
back write leaves no history.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from ..models import ACTIVE_STATE_TYPES, Asset, AssetEvent, AssetFieldValue, AssetStatus, StateType
from . import tags as tag_service
from .details import FieldResolver, serialize, validate_values, write_values
from .parsing import org_today

# (key, label) of the core fields, in form order. FK keys hold model instances.
CORE_FIELDS: list[tuple[str, str]] = [
    ("name", "Asset Name"),
    ("asset_tag", "Asset Tag"),
    ("vendor", "Vendor"),
    ("category", "Category"),
    ("sub_category", "Sub-category"),
    ("status", "Status"),
    ("location", "Location"),
    ("assigned_user", "User"),
    ("department", "Department"),
    ("allotment_notes", "Allotment Notes"),
    ("purchase_date", "Purchase Date"),
    ("purchase_cost", "Purchase Cost"),
    ("expiry_date", "Expiry Date"),
    ("warranty_expiry_date", "Warranty Expiry Date"),
]
FK_FIELDS = {"vendor", "category", "sub_category", "status", "location", "assigned_user", "department"}
LABELS = dict(CORE_FIELDS)
NOTES_MAX = 2000


class AssetValidationError(Exception):
    """Field errors: ``{field: [msg]}``; detail-field errors use ``details.<key>``."""

    def __init__(self, errors: dict):
        super().__init__("Asset validation failed")
        self.errors = errors


def user_label(user) -> str:
    if user is None:
        return ""
    return (getattr(user, "full_name", "") or "").strip() or user.username


def display_core(key: str, value) -> str | None:
    if value is None or value == "":
        return None
    if key == "assigned_user":
        return user_label(value)
    if key in FK_FIELDS:
        return getattr(value, "name", str(value))
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    return str(value)


def default_status():
    return (AssetStatus.objects.filter(is_default=True).first()
            or AssetStatus.objects.order_by("sort_order", "name").first())


def expire_target():
    return AssetStatus.objects.filter(auto_expire_target=True, state_type=StateType.RETIRED).first()


def log_event(asset, actor, action, *, changes=None, note=""):
    return AssetEvent.objects.create(
        asset=asset,
        actor=actor if (actor and getattr(actor, "pk", None)) else None,
        action=action, changes=changes or [], note=note[:255],
    )


def _changed(instance, key, value) -> bool:
    if instance is None:
        return True
    if key in FK_FIELDS:
        return getattr(instance, f"{key}_id") != (value.pk if value is not None else None)
    return getattr(instance, key) != value


def validate_core(data: dict, *, helpdesk, today, instance=None, tag_check=None) -> dict:
    """Business rules shared by the API and the import. Normalises ``data`` in place."""
    errors: dict = {}

    def add(key, msg):
        errors.setdefault(key, []).append(msg)

    name = " ".join(str(data.get("name") or "").split())
    data["name"] = name
    if not name:
        add("name", "Enter the asset name.")
    elif len(name) > 200:
        add("name", "Keep the name under 200 characters.")

    tag = tag_service.normalize(data.get("asset_tag"))
    data["asset_tag"] = tag
    if len(tag) > tag_service.TAG_MAX:
        add("asset_tag", f"Keep the tag under {tag_service.TAG_MAX} characters.")
    elif not tag and instance is not None:
        add("asset_tag", "An asset needs a tag.")
    elif tag and tag_check is not None and _changed(instance, "asset_tag", tag) and tag_check(tag):
        add("asset_tag", f"Asset tag “{tag}” is already used by another asset.")

    notes = str(data.get("allotment_notes") or "").strip()
    data["allotment_notes"] = notes
    if len(notes) > NOTES_MAX:
        add("allotment_notes", f"Keep the notes under {NOTES_MAX:,} characters.")

    cat = data.get("category")
    sub = data.get("sub_category")
    if cat is None:
        add("category", "Choose a category.")
    elif cat.is_deleted or cat.helpdesk_id != helpdesk.id:
        add("category", "That category isn't available in this helpdesk.")
    elif cat.parent_id is not None:
        add("category", f"“{cat.name}” is a sub-category. Pick its category here and put it in Sub-category.")
    elif not cat.is_active and _changed(instance, "category", cat):
        add("category", f"“{cat.name}” is inactive. Pick another category.")
    if sub is not None and cat is not None and "category" not in errors:
        if sub.is_deleted or sub.parent_id != cat.id:
            add("sub_category", f"“{sub.name}” isn't a sub-category of “{cat.name}”.")
        elif not sub.is_active and _changed(instance, "sub_category", sub):
            add("sub_category", f"“{sub.name}” is inactive. Pick another sub-category.")

    status = data.get("status")
    if status is None:
        add("status", "Choose a status.")
    elif status.is_deleted:
        add("status", "That status was deleted. Pick another one.")

    for key in ("vendor", "location", "department"):
        obj = data.get(key)
        if obj is None:
            continue
        if obj.is_deleted:
            add(key, f"That {LABELS[key].lower()} was deleted.")
        elif not obj.is_active and _changed(instance, key, obj):
            add(key, f"“{obj.name}” is inactive. Pick another {LABELS[key].lower()}.")

    user = data.get("assigned_user")
    if user is not None and not user.is_active and _changed(instance, "assigned_user", user):
        add("assigned_user", "That user is inactive.")

    if status is not None and status.state_type == StateType.IN_USE \
            and data.get("assigned_user") is None and data.get("department") is None:
        add("assigned_user", f"“{status.name}” needs a User or a Department.")

    purchase = data.get("purchase_date")
    for key in ("expiry_date", "warranty_expiry_date"):
        d = data.get(key)
        if d and purchase and d < purchase:
            add(key, "Can't be before the purchase date.")

    expiry = data.get("expiry_date")
    if status is not None and expiry and expiry < today and status.state_type in ACTIVE_STATE_TYPES \
            and (_changed(instance, "status", status) or _changed(instance, "expiry_date", expiry)):
        add("status", (
            f"The expiry date ({expiry.isoformat()}) has passed, so the status can't be "
            f"“{status.name}”. Change the Expiry Date, or pick a retired status such as Expired."
        ))
    return errors


def _detail_errors(derr: dict) -> dict:
    return {f"details.{k}": v for k, v in derr.items()}


def _set_allotment_stamp(asset, before_user_id, before_dept_id):
    if (asset.assigned_user_id, asset.department_id) == (before_user_id, before_dept_id):
        return
    asset.allotted_at = timezone.now() if (asset.assigned_user_id or asset.department_id) else None


def snapshot(asset) -> dict:
    return {key: display_core(key, getattr(asset, key)) for key, _ in CORE_FIELDS}


def diff(before: dict, after: dict) -> list[dict]:
    return [
        {"field": key, "label": LABELS[key], "old": before.get(key), "new": after.get(key)}
        for key, _ in CORE_FIELDS
        if before.get(key) != after.get(key)
    ]


@transaction.atomic
def create_asset(*, helpdesk, data: dict, details: dict | None, actor):
    """Create one asset. ``data`` holds resolved objects; ``details`` is ``{key: raw}``."""
    today = org_today()
    data = dict(data)
    if data.get("status") is None:
        data["status"] = default_status()
    tag_service.lock_tags()
    errors = validate_core(data, helpdesk=helpdesk, today=today,
                           tag_check=lambda t: tag_service.tag_taken(t))
    eff = []
    if "category" not in errors and "sub_category" not in errors and data.get("category"):
        sub = data.get("sub_category")
        eff = FieldResolver(helpdesk.id).for_category(data["category"].id, sub.id if sub else None)
    clean, derr = validate_values(eff, details or {})
    errors.update(_detail_errors(derr))
    if errors:
        raise AssetValidationError(errors)
    if not data["asset_tag"]:
        data["asset_tag"] = tag_service.allocate(helpdesk, 1)[0]
    asset = Asset(helpdesk=helpdesk, created_by=actor, updated_by=actor,
                  **{k: data.get(k) for k, _ in CORE_FIELDS})
    if asset.assigned_user_id or asset.department_id:
        asset.allotted_at = timezone.now()
    asset.save()
    write_values(asset, eff, clean, existing={})
    log_event(asset, actor, AssetEvent.Action.CREATED)
    return asset


@transaction.atomic
def update_asset(asset, *, data: dict, details: dict | None, actor):
    """Update an asset. Keys absent from ``data`` keep their value; ``details=None``
    keeps the current detail values (still validated against the category)."""
    today = org_today()
    asset = (Asset.objects.select_for_update(of=("self",))
             .select_related(*FK_FIELDS, "helpdesk").get(pk=asset.pk))
    helpdesk = asset.helpdesk
    merged = {key: (data[key] if key in data else getattr(asset, key)) for key, _ in CORE_FIELDS}
    tag_changed = "asset_tag" in data and tag_service.normalize(data["asset_tag"]).lower() \
        != asset.asset_tag.lower()
    if tag_changed:
        tag_service.lock_tags()
    errors = validate_core(merged, helpdesk=helpdesk, today=today, instance=asset,
                           tag_check=lambda t: tag_service.tag_taken(t, exclude_id=asset.pk))

    eff = []
    existing = {r.field_id: r for r in AssetFieldValue.objects.filter(asset=asset).select_related("field")}
    if "category" not in errors and "sub_category" not in errors and merged.get("category"):
        sub = merged.get("sub_category")
        eff = FieldResolver(helpdesk.id).for_category(merged["category"].id, sub.id if sub else None)
    if details is None:
        details = {row.field.key: serialize(row.field.field_type, row) for row in existing.values()}
    clean, derr = validate_values(eff, details)
    errors.update(_detail_errors(derr))
    if errors:
        raise AssetValidationError(errors)

    before = snapshot(asset)
    before_user, before_dept = asset.assigned_user_id, asset.department_id
    for key, _ in CORE_FIELDS:
        setattr(asset, key, merged[key])
    _set_allotment_stamp(asset, before_user, before_dept)
    asset.updated_by = actor
    asset.save()
    changes = diff(before, snapshot(asset)) + write_values(asset, eff, clean, existing=existing)
    if changes:
        log_event(asset, actor, AssetEvent.Action.UPDATED, changes=changes)
    # An unchanged active status with an already-passed expiry (the hourly sweep
    # hasn't reached it yet) is marked Expired now, like the sweep would.
    expire_if_due(asset, today=today)
    return asset


@transaction.atomic
def delete_asset(asset, *, actor):
    log_event(asset, actor, AssetEvent.Action.DELETED)
    asset.soft_delete(user=actor)


def expire_if_due(asset, *, today=None, target=None):
    """Move one asset to the Expired status if its Expiry Date has passed."""
    today = today or org_today()
    if not asset.expiry_date or asset.expiry_date >= today:
        return False
    if asset.status.state_type not in ACTIVE_STATE_TYPES:
        return False
    target = target or expire_target()
    if target is None or target.pk == asset.status_id:
        return False
    old = asset.status
    asset.status = target
    asset.save(update_fields=["status", "updated_at"])
    log_event(asset, None, AssetEvent.Action.AUTO_EXPIRED, changes=[
        {"field": "status", "label": LABELS["status"], "old": old.name, "new": target.name},
    ], note=f"Expiry date {asset.expiry_date.isoformat()} has passed.")
    return True


def sweep_expired() -> int:
    """Hourly per-org job: expire every active asset whose Expiry Date has passed.

    Safe to run twice at once: rows are claimed with ``SKIP LOCKED`` and re-checked,
    and an event is written only for rows that actually changed.
    """
    target = expire_target()
    if target is None:
        return 0
    today = org_today()
    with transaction.atomic():
        rows = list(
            Asset.objects.filter(
                expiry_date__lt=today, status__state_type__in=ACTIVE_STATE_TYPES,
            ).exclude(status=target)
            .select_for_update(skip_locked=True, of=("self",))
            .select_related("status")
        )
        changed = 0
        for asset in rows:
            if expire_if_due(asset, today=today, target=target):
                changed += 1
    return changed
