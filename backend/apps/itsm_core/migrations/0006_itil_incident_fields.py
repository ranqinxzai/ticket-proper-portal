"""Data migration — ITIL Incident Impact Assessment + Resolution Details fields.

Creates the global system ``FieldDefinition``s (column-backed via ``config.maps_to``)
for the ITIL Incident fields and their options, then backfills the **Impact
Assessment** + **Resolution Details** layout sections onto every existing
Incident-project default layout (relocating Priority into Impact Assessment,
agent-only). Runs once per tenant schema via ``migrate_schemas --tenant``.

Idempotent (get_or_create / update_or_create), mirroring the seed helpers in
``apps.itsm_core.seed`` (which cover fresh orgs). Constants are inlined here so the
migration stays immutable and self-contained (repo convention — see migration 0005).
"""

from __future__ import annotations

from django.db import migrations

# (key, name, field_type, config, [(value, label), ...])
NEW_FIELDS = [
    ("impact", "Impact", "dropdown", {"maps_to": "impact", "locked_options": True},
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")]),
    ("urgency", "Urgency", "dropdown", {"maps_to": "urgency", "locked_options": True},
        [("low", "Low"), ("medium", "Medium"), ("high", "High")]),
    ("business_impact", "Business Impact", "multiline", {"maps_to": "business_impact"}, []),
    ("users_affected", "Users Affected", "number", {"maps_to": "users_affected"}, []),
    ("service_downtime", "Service Downtime", "checkbox", {"maps_to": "service_downtime"}, []),
    ("major_incident", "Major Incident", "checkbox", {"maps_to": "major_incident"}, []),
    ("resolution_code", "Resolution Code", "dropdown",
        {"maps_to": "resolution_code", "locked_options": True},
        [("fixed", "Fixed"), ("workaround", "Workaround"),
         ("duplicate", "Duplicate"), ("user_error", "User Error")]),
    ("root_cause", "Root Cause", "multiline", {"maps_to": "root_cause"}, []),
    ("workaround_provided", "Workaround Provided", "checkbox", {"maps_to": "workaround_provided"}, []),
    ("resolution_notes", "Resolution Notes", "multiline", {"maps_to": "resolution_notes"}, []),
]

# (field key, section, sort_order, region, width) — all agent-only + non-mandatory.
INCIDENT_LAYOUT = [
    ("impact", "Impact Assessment", 200, "main", "half"),
    ("urgency", "Impact Assessment", 210, "main", "half"),
    ("users_affected", "Impact Assessment", 230, "main", "half"),
    ("service_downtime", "Impact Assessment", 240, "main", "half"),
    ("major_incident", "Impact Assessment", 250, "main", "half"),
    ("business_impact", "Impact Assessment", 260, "main", "full"),
    ("resolution_code", "Resolution Details", 300, "main", "half"),
    ("workaround_provided", "Resolution Details", 310, "main", "half"),
    ("root_cause", "Resolution Details", 320, "main", "full"),
    ("resolution_notes", "Resolution Details", 330, "main", "full"),
]


def forward(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    FieldOption = apps.get_model("itsm_core", "FieldOption")
    FieldLayout = apps.get_model("itsm_core", "FieldLayout")
    FieldLayoutItem = apps.get_model("itsm_core", "FieldLayoutItem")
    Project = apps.get_model("itsm_projects", "Project")

    defs = {}
    for key, name, ftype, config, options in NEW_FIELDS:
        defn, _ = FieldDefinition.objects.get_or_create(
            project=None, key=key,
            defaults={"name": name, "field_type": ftype, "is_system": True,
                      "config": config, "is_multi": False},
        )
        if (defn.name, defn.field_type, defn.is_system, defn.config) != (name, ftype, True, config):
            defn.name, defn.field_type, defn.is_system, defn.config = name, ftype, True, config
            defn.save()
        for i, (val, label) in enumerate(options):
            FieldOption.objects.update_or_create(
                field=defn, value=val,
                defaults={"label": label, "sort_order": i, "level": 1, "parent": None},
            )
        defs[key] = defn

    priority = FieldDefinition.objects.filter(project=None, key="priority").first()

    for project in Project.objects.filter(is_deleted=False, project_type="incident"):
        layout = FieldLayout.objects.filter(
            project=project, ticket_type__isnull=True, is_deleted=False
        ).first()
        if layout is None:
            layout = FieldLayout.objects.create(
                project=project, ticket_type=None, name="Default Layout"
            )
        for key, section, sort_order, region, width in INCIDENT_LAYOUT:
            FieldLayoutItem.objects.get_or_create(
                layout=layout, field=defs[key],
                defaults={"section": section, "sort_order": sort_order,
                          "is_mandatory": False, "is_hidden": False,
                          "region": region, "width": width, "portal_visible": False},
            )
        # Relocate Priority into Impact Assessment (agent-only) if still in its
        # seeded sidebar spot — admin moves survive.
        if priority is not None:
            FieldLayoutItem.objects.filter(
                layout=layout, field=priority, section="Details",
            ).update(section="Impact Assessment", region="main", width="half",
                     sort_order=220, portal_visible=False, is_mandatory=False)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0005_fieldlayoutitem_portal_visible"),
        ("itsm_projects", "0008_project_priority_matrix"),
        ("itsm_tickets", "0005_ticket_business_impact_ticket_major_incident_and_more"),
    ]

    operations = [
        migrations.RunPython(forward, noop),
    ]
