"""Email channels → P1–P4 priorities.

Alters ``EmailChannel.default_priority`` choices + default, then remaps existing
``default_priority`` values and the ``priority_map`` *values* (email signal →
ticket priority). Map keys (X-Priority digits, Importance words, …) are unchanged;
only the mapped ticket priority moves critical→p1, high→p2, medium→p3, low→p4.
Runs per tenant schema via ``migrate_schemas``.
"""

from __future__ import annotations

from django.db import migrations, models

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
REVERSE_MAP = {v: k for k, v in PRIORITY_MAP.items()}
P_CHOICES = [("p1", "P1 – Critical"), ("p2", "P2 – High"),
             ("p3", "P3 – Medium"), ("p4", "P4 – Low")]


def _apply(apps, mapping):
    EmailChannel = apps.get_model("itsm_email", "EmailChannel")
    for ch in EmailChannel.objects.all().only("id", "default_priority", "priority_map"):
        changed = []
        if ch.default_priority in mapping:
            ch.default_priority = mapping[ch.default_priority]
            changed.append("default_priority")
        pmap = ch.priority_map or {}
        if isinstance(pmap, dict) and any(v in mapping for v in pmap.values()):
            ch.priority_map = {k: mapping.get(v, v) for k, v in pmap.items()}
            changed.append("priority_map")
        if changed:
            ch.save(update_fields=changed)


def forward(apps, schema_editor):
    _apply(apps, PRIORITY_MAP)


def backward(apps, schema_editor):
    _apply(apps, REVERSE_MAP)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_email", "0002_emailchannel_oauth_client_id_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="emailchannel", name="default_priority",
            field=models.CharField(choices=P_CHOICES, default="p3", max_length=10),
        ),
        migrations.RunPython(forward, backward),
    ]
