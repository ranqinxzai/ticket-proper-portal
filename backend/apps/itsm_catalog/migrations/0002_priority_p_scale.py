"""Catalog items → P1–P4 default priority.

Alters ``CatalogItem.default_priority`` column default (medium→p3) and remaps existing
values (critical→p1, high→p2, medium→p3, low→p4). Runs per tenant schema.
"""

from __future__ import annotations

from django.db import migrations, models

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
REVERSE_MAP = {v: k for k, v in PRIORITY_MAP.items()}


def _apply(apps, mapping):
    CatalogItem = apps.get_model("itsm_catalog", "CatalogItem")
    for old, new in mapping.items():
        CatalogItem.objects.filter(default_priority=old).update(default_priority=new)


def forward(apps, schema_editor):
    _apply(apps, PRIORITY_MAP)


def backward(apps, schema_editor):
    _apply(apps, REVERSE_MAP)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_catalog", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="catalogitem", name="default_priority",
            field=models.CharField(default="p3", max_length=10),
        ),
        migrations.RunPython(forward, backward),
    ]
