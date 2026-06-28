"""Seed the built-in **Admin** system role for existing tenants.

The Admin role (code ``admin``) holds full CRUD on every module — the explicit
top-level "owner" role, mirroring Supervisor's grants. New tenants get it from
``seed_rbac`` at provision time; this migration backfills it into already-seeded
schemas so existing orgs gain the role on the next ``migrate_schemas`` run.

Idempotent and runs per-schema under ``migrate_schemas`` (RunPython executes
inside each tenant schema). On a freshly created schema the ``Module`` table is
still empty at migration time (modules are seeded *after* migrations by
``provision_org`` → ``seed_itsm``), so this only creates the role; ``seed_rbac``
then grants it CRUD on every module. On an existing schema the modules are
already present, so the full grant set is written here.
"""

from django.db import migrations

FULL_CRUD = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}


def seed_admin_role(apps, schema_editor):
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    # ``update_or_create`` (not ``get_or_create``) so a tenant that already has a
    # stray *custom* role with code ``admin`` (e.g. hand-made via the roles UI) is
    # normalised into the authoritative built-in role — ``is_system`` set so it
    # can't be deleted, mirroring ``seed_rbac``.
    admin, _ = SystemRole.objects.update_or_create(
        code="admin",
        defaults={
            "name": "Admin",
            "is_system": True,
            "is_active": True,
            "description": "Full access to every module — the top-level owner role.",
        },
    )

    for module in Module.objects.all():
        RoleModulePermission.objects.update_or_create(
            role=admin, module=module, defaults=dict(FULL_CRUD),
        )


def drop_admin_role(apps, schema_editor):
    """Reverse: remove the Admin role + its grants (only if unassigned)."""
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")
    RoleAssignment = apps.get_model("itsm_rbac", "RoleAssignment")

    admin = SystemRole.objects.filter(code="admin").first()
    if not admin or RoleAssignment.objects.filter(role=admin).exists():
        return  # leave it in place if any user still holds it (FK is PROTECT)
    RoleModulePermission.objects.filter(role=admin).delete()
    admin.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0001_initial"),
    ]

    operations = [migrations.RunPython(seed_admin_role, drop_admin_role)]
