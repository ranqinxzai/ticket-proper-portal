"""Data migration — tag the global ITIL Incident field definitions `incident_only`.

`0006` created the ITIL Impact-Assessment / Resolution field definitions as **global**
(`project=null`) system fields — so, like `priority`/`mode`/`source`, they surfaced in
**every** project's Fields catalog (incl. Request). This backfills
`config.incident_only = True` on them; `FieldDefinitionViewSet.get_queryset` then hides
them from non-Incident projects' Fields catalog + layout palette (they remain global defs
and still work on Incident layouts). Idempotent; runs per tenant via `migrate_schemas`.
"""

from __future__ import annotations

from django.db import migrations

ITIL_KEYS = [
    "impact", "urgency", "business_impact", "users_affected", "service_downtime",
    "major_incident", "resolution_code", "root_cause", "workaround_provided", "resolution_notes",
]


def forward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    for defn in FieldDefinition.objects.filter(project__isnull=True, key__in=ITIL_KEYS):
        cfg = dict(defn.config or {})
        if not cfg.get("incident_only"):
            cfg["incident_only"] = True
            defn.config = cfg
            defn.save(update_fields=["config"])


def backward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    for defn in FieldDefinition.objects.filter(project__isnull=True, key__in=ITIL_KEYS):
        cfg = dict(defn.config or {})
        if "incident_only" in cfg:
            cfg.pop("incident_only")
            defn.config = cfg
            defn.save(update_fields=["config"])


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0007_alive_scoped_unique_constraints"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
