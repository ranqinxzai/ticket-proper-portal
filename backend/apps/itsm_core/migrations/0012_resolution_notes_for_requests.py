"""Data migration — make the global **Resolution Notes** def apply to Request projects.

`resolution_notes` (column-backed → `Ticket.resolution_notes`) was tagged
`applies_to: ["incident", "problem"]`, so Request projects never saw it in their
Fields catalog / transition capture picker / filter registry. Admins then created a
per-project custom "Resolution Note" for the Request **Fulfil** step — a second,
value-backed field the Ticket Data report shows as a separate column (GridCrest,
2026-10-14). One canonical column-backed note serves every standard type instead.

Mirrors `apps.itsm_core.seed.GLOBAL_FIELDS` (constant inlined so the migration stays
immutable). Idempotent; reverse drops `service_request` again. Runs once per tenant
schema via `migrate_schemas`.
"""

from __future__ import annotations

from django.db import migrations

KEY = "resolution_notes"
TYPE = "service_request"


def forward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    for defn in FieldDefinition.objects.filter(project__isnull=True, key=KEY, is_deleted=False):
        cfg = dict(defn.config or {})
        applies = list(cfg.get("applies_to") or [])
        if "applies_to" in cfg and TYPE not in applies:
            cfg["applies_to"] = applies + [TYPE]
            defn.config = cfg
            defn.save(update_fields=["config"])


def backward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    for defn in FieldDefinition.objects.filter(project__isnull=True, key=KEY):
        cfg = dict(defn.config or {})
        applies = list(cfg.get("applies_to") or [])
        if TYPE in applies:
            cfg["applies_to"] = [t for t in applies if t != TYPE]
            defn.config = cfg
            defn.save(update_fields=["config"])


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0011_problem_fields_applies_to"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
