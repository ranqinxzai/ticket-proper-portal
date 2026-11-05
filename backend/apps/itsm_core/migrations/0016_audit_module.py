"""Seed the ``itsm.admin.audit`` permission module (Tenant Settings → Audit log).

Lives in itsm_core (the audit log's app) but writes itsm_rbac rows, so it depends on
the latest itsm_rbac migration. New tenants get the same from ``seed_rbac``
(registry: MODULES + ADMIN_ONLY_MODULES).

* Module: created/normalised (name, description, Settings category, parent itsm.admin).
* Admin: full CRUD (mirrors seed_rbac; only Read is ever checked — the API is read-only).
* Supervisor / Agent / Requestor: an explicit no-access row. Supervisor's matters: it
  holds full CRUD on ``itsm.admin`` and would otherwise INHERIT the log (closest
  ancestor with a row decides). ``get_or_create`` never overwrites an existing row.
* Custom roles get no row — they inherit from their ``itsm.admin`` grant, if any.

Idempotent and per-schema. On a freshly created schema the Module/Role tables are
empty at migrate time, so this only creates the bare module and ``seed_rbac`` wires
the parent + grants afterwards. Reverse drops the module and its grants.
"""

from django.db import migrations

CODE = "itsm.admin.audit"
FULL = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
NONE = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}


def seed_audit_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    parent = Module.objects.filter(code="itsm.admin").first()
    module, _ = Module.objects.update_or_create(
        code=CODE,
        defaults={
            "name": "Audit Log",
            "description": (
                "Read opens Tenant Settings → Audit log (sign-ins and failed sign-ins, user, "
                "role and permission changes, configuration changes) and its CSV export. "
                "Read-only; Admin-only by default."
            ),
            "category": "administration",
            "sort_order": 905,
            "is_active": True,
            "parent": parent,
        },
    )
    admin = SystemRole.objects.filter(code="admin").first()
    if admin is not None:
        RoleModulePermission.objects.get_or_create(role=admin, module=module, defaults=dict(FULL))
    for code in ("supervisor", "agent", "requestor"):
        role = SystemRole.objects.filter(code=code).first()
        if role is not None:
            RoleModulePermission.objects.get_or_create(role=role, module=module, defaults=dict(NONE))


def drop_audit_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    module = Module.objects.filter(code=CODE).first()
    if module is None:
        return
    RoleModulePermission.objects.filter(module=module).delete()
    module.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0015_admin_audit_event"),
        ("itsm_rbac", "0014_backfill_enforced_module_grants"),
    ]

    operations = [migrations.RunPython(seed_audit_module, drop_audit_module)]
