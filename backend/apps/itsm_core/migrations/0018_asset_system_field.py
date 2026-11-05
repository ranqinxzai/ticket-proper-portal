"""Asset Management phase 2: the global system field "Asset" (idempotent, per org).

* Creates/refreshes the global ``asset`` FieldDefinition (type ``asset_picker``,
  ``config.maps_to = "assets"`` → TicketAsset links, never a FieldValue).
* Places it on every live project's default layout (People section, after
  Requestor, sidebar, Portal on). It starts **visible** where the project's helpdesk
  has asset categories and **hidden** elsewhere — there is no on/off switch; admins
  show or hide it per layout. ``get_or_create`` never overwrites an existing item.

Constants are copied here (migrations never import app code); the same entry lives in
``itsm_core/seed.py`` for new orgs and new projects.
"""

from django.db import migrations

KEY = "asset"
DEF = {"name": "Asset", "field_type": "asset_picker", "is_system": True, "is_multi": False,
       "config": {"maps_to": "assets"}}
ITEM = {"section": "People", "sort_order": 75, "is_mandatory": False, "region": "sidebar",
        "width": "full", "portal_visible": True}


def forwards(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    FieldLayout = apps.get_model("itsm_core", "FieldLayout")
    FieldLayoutItem = apps.get_model("itsm_core", "FieldLayoutItem")
    Project = apps.get_model("itsm_projects", "Project")
    AssetCategory = apps.get_model("itsm_assets", "AssetCategory")

    field, created = FieldDefinition.objects.get_or_create(
        project=None, key=KEY, is_deleted=False, defaults=dict(DEF))
    if not created:
        changed = False
        for attr, value in DEF.items():
            if getattr(field, attr) != value:
                setattr(field, attr, value)
                changed = True
        if changed:
            field.save()

    with_assets = set(AssetCategory.objects.filter(is_deleted=False)
                      .values_list("helpdesk_id", flat=True).distinct())
    for project in Project.objects.filter(is_deleted=False):
        layout = FieldLayout.objects.filter(project=project, ticket_type__isnull=True,
                                            is_deleted=False).first()
        if layout is None:
            continue  # ensure_project_layout (seed) creates it later, with the field
        FieldLayoutItem.objects.get_or_create(
            layout=layout, field=field, is_deleted=False,
            defaults={**ITEM, "is_hidden": project.helpdesk_id not in with_assets})


def backwards(apps, schema_editor):
    FieldDefinition = apps.get_model("itsm_core", "FieldDefinition")
    FieldLayoutItem = apps.get_model("itsm_core", "FieldLayoutItem")
    FieldLayoutItem.objects.filter(field__project__isnull=True, field__key=KEY).delete()
    FieldDefinition.objects.filter(project__isnull=True, key=KEY).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0017_alter_auditevent_action_and_more"),
        ("itsm_assets", "0004_alter_assetevent_action"),
        ("itsm_projects", "0010_project_type_problem"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
