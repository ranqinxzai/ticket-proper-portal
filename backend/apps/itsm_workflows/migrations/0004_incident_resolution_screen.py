"""Data migration — Incident Resolve screen (ITIL Resolution Details capture).

For every Incident workflow (``base_type == "incident"``), create the
"Resolution Details" ``TransitionScreen`` + its fields, attach it to the
**Resolve** transition, and add the ``set_resolution_details`` post-function so the
engine persists the captured fields to the Ticket columns. Runs once per tenant
schema via ``migrate_schemas --tenant``.

Idempotent (get_or_create + presence checks), mirroring
``apps.itsm_workflows.seed.ensure_resolution_screen`` (fresh orgs).
"""

from __future__ import annotations

from django.db import migrations

# (field_key, sort_order) — non-mandatory by default; admins can require them.
SCREEN_FIELDS = [
    ("resolution_code", 10),
    ("root_cause", 20),
    ("workaround_provided", 30),
    ("resolution_notes", 40),
]


def forward(apps, schema_editor):
    Workflow = apps.get_model("itsm_workflows", "Workflow")
    Transition = apps.get_model("itsm_workflows", "Transition")
    TransitionScreen = apps.get_model("itsm_workflows", "TransitionScreen")
    TransitionScreenField = apps.get_model("itsm_workflows", "TransitionScreenField")

    for wf in Workflow.objects.filter(is_deleted=False, base_type="incident"):
        resolve = Transition.objects.filter(
            workflow=wf, name="Resolve", is_deleted=False
        ).first()
        if resolve is None:
            continue
        screen, _ = TransitionScreen.objects.get_or_create(
            workflow=wf, name="Resolution Details"
        )
        for field_key, order in SCREEN_FIELDS:
            TransitionScreenField.objects.get_or_create(
                screen=screen, field_key=field_key,
                defaults={"is_mandatory": False, "sort_order": order},
            )
        changed = False
        if resolve.screen_id != screen.id:
            resolve.screen = screen
            changed = True
        pfs = list(resolve.post_functions or [])
        if not any((pf or {}).get("type") == "set_resolution_details" for pf in pfs):
            pfs.append({"type": "set_resolution_details", "config": {}})
            resolve.post_functions = pfs
            changed = True
        if changed:
            resolve.save()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_workflows", "0003_transition_portal_allowed"),
    ]

    operations = [
        migrations.RunPython(forward, noop),
    ]
