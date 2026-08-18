"""Seed the ``itsm.tickets.print`` permission module for existing tenants.

The ticket-detail **Print** action is gated on this dedicated module so it can be
revoked per role in Roles & Permissions. New tenants get the module + its grants from
``seed_rbac`` at provision time; this backfills already-seeded schemas so existing orgs
gain the "Print Ticket" permission on the next ``migrate_schemas`` run. By product
decision print is granted by default to **Agent + Supervisor + Admin** (Supervisor/Admin
get full CRUD like every module; Agent gets read/create/update — the FE gate checks the
``read`` bit); Requestor gets no grant.

Idempotent, runs per-schema under ``migrate_schemas``. On a freshly created schema the
modules/roles are seeded *after* migrations by ``provision_org`` → ``seed_itsm``, so the
role lookups return nothing and only the bare module is created; ``seed_rbac`` then wires
the parent + grants. Mirrors ``0009_seed_tickets_move_module``.
"""

from django.db import migrations

FULL_CRUD = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
AGENT_RW = {"can_read": True, "can_create": True, "can_update": True, "can_delete": False}


def seed_print_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    parent = Module.objects.filter(code="itsm.tickets").first()
    module, _ = Module.objects.update_or_create(
        code="itsm.tickets.print",
        defaults={
            "name": "Print Ticket",
            "sort_order": 111,
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


def drop_print_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    module = Module.objects.filter(code="itsm.tickets.print").first()
    if module is None:
        return
    RoleModulePermission.objects.filter(module=module).delete()
    module.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0009_seed_tickets_move_module"),
    ]

    operations = [migrations.RunPython(seed_print_module, drop_print_module)]
