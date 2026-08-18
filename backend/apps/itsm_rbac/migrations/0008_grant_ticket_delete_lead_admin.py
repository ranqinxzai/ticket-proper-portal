"""Backfill **ticket delete** for the Admin + Supervisor (lead) roles in existing tenants.

Ticket delete is a normal grantable RBAC bit — `RoleModulePermission.can_delete` on the
`itsm.tickets` module — not a hardcoded rule. New tenants get it from ``seed_rbac`` at
provision time (Admin + Supervisor = full CRUD; Agent excluded). This migration backfills
it into already-seeded schemas so existing orgs where the grant was never set — or was
removed by a hand-edit in the roles-admin matrix (e.g. gridcrest's customised Supervisor,
which diverged from the seed) — regain it on the next ``migrate_schemas`` run.

Idempotent and runs per-schema under ``migrate_schemas`` (RunPython executes inside each
tenant schema). Only the **delete** bit is touched on an existing grant row, so any
hand-edited read/create/update bits are preserved. On a freshly created schema the
``Module`` table is still empty at migration time (modules are seeded *after* migrations by
``provision_org`` → ``seed_itsm``), so this is a no-op there and ``seed_rbac`` grants the
full CRUD (incl. delete) afterwards. Depends on ``0007_module_category`` purely to keep the
migration graph linear — the two changes are otherwise independent (this touches only
``RoleModulePermission``, never ``Module``).
"""

from django.db import migrations

# Roles that should be able to delete tickets by default: Admin (owner) + Supervisor (lead).
LEAD_ADMIN_ROLE_CODES = ("admin", "supervisor")
FULL_CRUD = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}


def grant_ticket_delete(apps, schema_editor):
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    module = Module.objects.filter(code="itsm.tickets").first()
    if module is None:
        return  # fresh schema — modules seeded later by seed_rbac, which grants full CRUD

    for code in LEAD_ADMIN_ROLE_CODES:
        role = SystemRole.objects.filter(code=code).first()
        if role is None:
            continue
        perm, created = RoleModulePermission.objects.get_or_create(
            role=role, module=module, defaults=dict(FULL_CRUD),
        )
        # Existing row: flip only the delete bit so hand-edited read/create/update survive.
        if not created and not perm.can_delete:
            perm.can_delete = True
            perm.save(update_fields=["can_delete", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0007_module_category"),
    ]

    # Reverse is a no-op: revoking ticket delete from Admin/Supervisor would break the
    # intended default and is never desirable on a rollback.
    operations = [migrations.RunPython(grant_ticket_delete, migrations.RunPython.noop)]
