"""Seed the ``itsm.admin.branding`` permission module for existing tenants.

New tenants get the module + its Admin/Supervisor grants from ``seed_rbac`` at
provision time. This migration backfills it into already-seeded schemas so
existing orgs gain the "Branding" admin surface on the next ``migrate_schemas``
run.

Idempotent and runs per-schema under ``migrate_schemas`` (RunPython executes
inside each tenant schema). On a freshly created schema the ``Module`` table is
still empty at migration time (modules are seeded *after* migrations by
``provision_org`` → ``seed_itsm``), so the parent/role lookups return nothing and
this only creates the bare module; ``seed_rbac`` then wires its parent and grants.
On an existing schema the modules/roles are present, so the full grant set is
written here.
"""

from django.db import migrations

FULL_CRUD = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}


def seed_branding_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    parent = Module.objects.filter(code="itsm.admin").first()
    module, _ = Module.objects.update_or_create(
        code="itsm.admin.branding",
        defaults={
            "name": "Branding",
            "sort_order": 904,
            "is_active": True,
            "parent": parent,
        },
    )

    # Admin + Supervisor are the full-access tiers (mirrors seed_rbac).
    for code in ("admin", "supervisor"):
        role = SystemRole.objects.filter(code=code).first()
        if role is not None:
            RoleModulePermission.objects.update_or_create(
                role=role, module=module, defaults=dict(FULL_CRUD),
            )


def drop_branding_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    module = Module.objects.filter(code="itsm.admin.branding").first()
    if module is None:
        return
    RoleModulePermission.objects.filter(module=module).delete()
    module.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0012_tenantbrandingconfig"),
    ]

    operations = [migrations.RunPython(seed_branding_module, drop_branding_module)]
