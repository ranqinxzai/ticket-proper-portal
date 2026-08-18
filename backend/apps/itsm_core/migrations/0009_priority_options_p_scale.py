"""Replace the global ``priority`` dropdown's FieldOptions with the P1–P4 scale.

The ``priority`` FieldDefinition is a locked-options global system field whose options
back the ticket-form Priority picker. This swaps its legacy low/medium/high/critical
options for p1–p4 (labels "P1 – Critical" … "P4 – Low"). Tickets store priority in the
mapped ``priority`` column (not via a FieldOption FK), so removing the old options is
safe. Impact/Urgency options are untouched. Idempotent; runs per tenant schema.
"""

from __future__ import annotations

from django.db import migrations

LEGACY = ["low", "medium", "high", "critical"]
NEW_OPTIONS = [("p1", "P1 – Critical"), ("p2", "P2 – High"),
               ("p3", "P3 – Medium"), ("p4", "P4 – Low")]
OLD_OPTIONS = [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")]


def _rewrite_options(apps, drop_values, add_options):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    FieldOption = apps.get_model("itsm_core", "FieldOption")
    for defn in FieldDefinition.objects.filter(project__isnull=True, key="priority", is_deleted=False):
        FieldOption.objects.filter(field=defn, value__in=drop_values).delete()
        for i, (val, label) in enumerate(add_options):
            FieldOption.objects.update_or_create(
                field=defn, value=val,
                defaults={"label": label, "sort_order": i, "level": 1,
                          "parent": None, "is_deleted": False},
            )


def forward(apps, schema_editor):
    _rewrite_options(apps, LEGACY, NEW_OPTIONS)


def backward(apps, schema_editor):
    _rewrite_options(apps, [v for v, _ in NEW_OPTIONS], OLD_OPTIONS)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0008_itil_fields_incident_only"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
