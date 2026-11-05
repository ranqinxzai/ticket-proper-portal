"""Seed the six default asset statuses in every org (idempotent).

Literal values (migrations never import app code). The same list lives in
``itsm_assets/seed.py`` for ``seed_itsm``. Skipped when the org already has any
status, so an admin's edits are never overwritten.
"""

from django.db import migrations

# (name, key, state_type, color, is_default, auto_expire_target, sort_order)
DEFAULT_STATUSES = [
    ("In Stock", "in_stock", "available", "#0284c7", True, False, 10),
    ("In Use", "in_use", "in_use", "#16a34a", False, False, 20),
    ("In Repair", "in_repair", "maintenance", "#d97706", False, False, 30),
    ("Expired", "expired", "retired", "#7c3aed", False, True, 40),
    ("Disposed", "disposed", "retired", "#64748b", False, False, 50),
    ("Lost", "lost", "missing", "#dc2626", False, False, 60),
]


def seed_statuses(apps, schema_editor):
    AssetStatus = apps.get_model("itsm_assets", "AssetStatus")
    if AssetStatus.objects.exists():
        return
    for name, key, state, color, default, target, order in DEFAULT_STATUSES:
        AssetStatus.objects.create(name=name, key=key, state_type=state, color=color,
                                   is_default=default, auto_expire_target=target, sort_order=order)


def drop_statuses(apps, schema_editor):
    AssetStatus = apps.get_model("itsm_assets", "AssetStatus")
    Asset = apps.get_model("itsm_assets", "Asset")
    if not Asset.objects.exists():
        AssetStatus.objects.filter(key__in=[s[1] for s in DEFAULT_STATUSES]).delete()


class Migration(migrations.Migration):

    dependencies = [("itsm_assets", "0001_initial")]

    operations = [migrations.RunPython(seed_statuses, drop_statuses)]
