"""Seed the ``itsm.tickets.move`` permission module for existing tenants.

New tenants get the module + its grants from ``seed_rbac`` at provision time; this
backfills already-seeded schemas so existing orgs gain the "Move Ticket" permission
on the next ``migrate_schemas`` run. By product decision the move action is granted
by default to **Agent + Supervisor + Admin** (Supervisor/Admin get full CRUD like
every module; Agent gets read/create/update — enough to invoke the action, which
maps POST → ``create``).

Idempotent, runs per-schema under ``migrate_schemas``. On a freshly created schema
the modules/roles are seeded *after* migrations by ``provision_org`` → ``seed_itsm``,
so the role lookups return nothing and only the bare module is created; ``seed_rbac``
then wires the parent + grants.
"""

from django.db import migrations

FULL_CRUD = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
AGENT_RW = {"can_read": True, "can_create": True, "can_update": True, "can_delete": False}


def seed_move_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    parent = Module.objects.filter(code="itsm.tickets").first()
    module, _ = Module.objects.update_or_create(
        code="itsm.tickets.move",
        defaults={
            "name": "Move Ticket",
            "sort_order": 109,
            "is_active": True,
            "parent": parent,
        },
    )

    grants = {"admin": FULL_CRUD, "supervisor": FULL_CRUD, "agent": AGENT_RW}
    for code, bits in grants.items():
        role = SystemRole.objects.filter(code=code).first()
        if role is not None:
            RoleModulePermission.objects.update_or_create(
                role=role, module=module, defaults=dict(bits),
            )


def drop_move_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    module = Module.objects.filter(code="itsm.tickets.move").first()
    if module is None:
        return
    RoleModulePermission.objects.filter(module=module).delete()
    module.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0008_grant_ticket_delete_lead_admin"),
    ]

    operations = [migrations.RunPython(seed_move_module, drop_move_module)]
