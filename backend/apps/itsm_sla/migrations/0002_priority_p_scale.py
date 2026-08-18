"""Remap SLA priority references to the P1–P4 scale.

Covers ``SLATarget.priority`` (per-priority targets) and any priority filter lists in
``SLAPolicy.applies_to`` (``{"priority": [...]}`)`. critical→p1, high→p2, medium→p3,
low→p4. Idempotent. Runs per tenant schema via ``migrate_schemas``.
"""

from __future__ import annotations

from django.db import migrations

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
REVERSE_MAP = {v: k for k, v in PRIORITY_MAP.items()}


def _apply(apps, mapping):
    SLATarget = apps.get_model("itsm_sla", "SLATarget")
    SLAPolicy = apps.get_model("itsm_sla", "SLAPolicy")
    for old, new in mapping.items():
        SLATarget.objects.filter(priority=old).update(priority=new)
    for policy in SLAPolicy.objects.all().only("id", "applies_to"):
        spec = policy.applies_to or {}
        pris = spec.get("priority")
        if isinstance(pris, list) and any(p in mapping for p in pris):
            spec = dict(spec)
            spec["priority"] = [mapping.get(p, p) for p in pris]
            policy.applies_to = spec
            policy.save(update_fields=["applies_to"])


def forward(apps, schema_editor):
    _apply(apps, PRIORITY_MAP)


def backward(apps, schema_editor):
    _apply(apps, REVERSE_MAP)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_sla", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
