"""Data migration — Problem Management field catalog for EXISTING tenants.

Three idempotent steps, mirroring the current `apps.itsm_core.seed` constants
(inlined here so the migration stays immutable — repo convention since 0005/0006);
fresh orgs get identical results from `seed_itsm`:

1. **Retag `config.incident_only` → `config.applies_to`** on the ten global ITIL
   defs. The boolean scoped a def to Incident projects only; the list form lets a
   def apply to several standard types (Impact/Urgency/root-cause/resolution set
   now also apply to Problem projects; users_affected/service_downtime/
   major_incident stay Incident-only). Deployed code reads `applies_to`
   (`field_service.inapplicable_global_keys`), so this MUST land with the code —
   otherwise the ITIL fields would leak into every Request/custom project's
   pickers until a seed re-run.
2. **Create the two Problem global system defs** — `workaround_notes`
   ("Workaround", the KEDB workaround description) and `investigation_reason`
   (JSM-style trigger dropdown), both column-backed (`config.maps_to`, columns
   added by itsm_tickets/0010) and `applies_to: ["problem"]`.
3. **Extend the shared `resolution_code` options** with Risk Accepted /
   Won't Fix (ServiceNow problem-resolution parity; useful to incidents too).

No layout backfill is needed: no Problem projects exist yet — an import runs
`ensure_project_layout` at import time. Reverse restores `incident_only`, drops
the two new defs (only if valueless) and the two new options. Runs once per
tenant schema via `migrate_schemas`.
"""

from __future__ import annotations

from django.db import migrations

# key -> applies_to list (mirrors apps.itsm_core.seed.GLOBAL_FIELDS)
APPLIES_TO = {
    "impact": ["incident", "problem"],
    "urgency": ["incident", "problem"],
    "business_impact": ["incident", "problem"],
    "users_affected": ["incident"],
    "service_downtime": ["incident"],
    "major_incident": ["incident"],
    "resolution_code": ["incident", "problem"],
    "root_cause": ["incident", "problem"],
    "workaround_provided": ["incident", "problem"],
    "resolution_notes": ["incident", "problem"],
}

# (key, name, field_type, config, [(value, label), ...])
NEW_FIELDS = [
    ("workaround_notes", "Workaround", "multiline",
     {"maps_to": "workaround_notes", "applies_to": ["problem"]}, []),
    ("investigation_reason", "Investigation Reason", "dropdown",
     {"maps_to": "investigation_reason", "locked_options": True,
      "applies_to": ["problem"]},
     [("recurring_incidents", "Recurring Incidents"),
      ("non_routine_incident", "Non-routine Incident"),
      ("major_incident_review", "Major Incident Review"),
      ("trend_analysis", "Proactive Trend Analysis"),
      ("other", "Other")]),
]

# Appended to the shared resolution_code def (sort_order continues after the
# four seeded options: fixed=0, workaround=1, duplicate=2, user_error=3).
NEW_RESOLUTION_OPTIONS = [
    ("risk_accepted", "Risk Accepted", 4),
    ("wont_fix", "Won't Fix", 5),
]


def forward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    FieldOption = apps.get_model("itsm_core", "FieldOption")

    # 1. incident_only -> applies_to
    for defn in FieldDefinition.objects.filter(
        project__isnull=True, key__in=list(APPLIES_TO), is_deleted=False
    ):
        cfg = dict(defn.config or {})
        cfg.pop("incident_only", None)
        if cfg.get("applies_to") != APPLIES_TO[defn.key]:
            cfg["applies_to"] = APPLIES_TO[defn.key]
        if cfg != (defn.config or {}):
            defn.config = cfg
            defn.save(update_fields=["config"])

    # 2. new Problem defs (+ options)
    for key, name, ftype, config, options in NEW_FIELDS:
        defn, created = FieldDefinition.objects.get_or_create(
            project=None, key=key,
            defaults={"name": name, "field_type": ftype, "is_system": True,
                      "config": config, "is_multi": False},
        )
        if not created and (defn.name, defn.field_type, defn.is_system, defn.config) != (
            name, ftype, True, config
        ):
            defn.name, defn.field_type, defn.is_system, defn.config = (
                name, ftype, True, config
            )
            defn.save(update_fields=["name", "field_type", "is_system", "config"])
        for i, (value, label) in enumerate(options):
            FieldOption.objects.update_or_create(
                field=defn, value=value,
                defaults={"label": label, "sort_order": i, "level": 1, "parent": None},
            )

    # 3. extra resolution codes on the shared def
    res = FieldDefinition.objects.filter(
        project__isnull=True, key="resolution_code", is_deleted=False
    ).first()
    if res is not None:
        for value, label, order in NEW_RESOLUTION_OPTIONS:
            FieldOption.objects.update_or_create(
                field=res, value=value,
                defaults={"label": label, "sort_order": order, "level": 1, "parent": None},
            )


def backward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    FieldOption = apps.get_model("itsm_core", "FieldOption")
    FieldValue = apps.get_model("itsm_core", "FieldValue")

    # applies_to -> incident_only (the pre-migration boolean semantics)
    for defn in FieldDefinition.objects.filter(
        project__isnull=True, key__in=list(APPLIES_TO)
    ):
        cfg = dict(defn.config or {})
        cfg.pop("applies_to", None)
        cfg["incident_only"] = True
        defn.config = cfg
        defn.save(update_fields=["config"])

    for key, *_ in NEW_FIELDS:
        defn = FieldDefinition.objects.filter(project__isnull=True, key=key).first()
        if defn is None:
            continue
        if not FieldValue.objects.filter(field=defn).exists():
            FieldOption.objects.filter(field=defn).delete()
            defn.delete()

    res = FieldDefinition.objects.filter(
        project__isnull=True, key="resolution_code"
    ).first()
    if res is not None:
        FieldOption.objects.filter(
            field=res, value__in=[v for v, _, _ in NEW_RESOLUTION_OPTIONS]
        ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0010_alter_auditevent_action"),
        # The two new defs' config.maps_to columns must exist first.
        ("itsm_tickets", "0010_ticket_problem_fields"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
