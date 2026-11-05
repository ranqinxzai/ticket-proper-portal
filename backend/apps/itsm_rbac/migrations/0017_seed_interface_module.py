"""Seed the ``itsm.admin.interface`` permission module and its grants (idempotent, per org).

"Interface: Classic or Modern" (2026-11-05, Modern B2): the org-wide default for the
agent app, whether agents may switch, and when Classic retires.

Grants — create-only (``get_or_create`` never overwrites an existing row, so a
hand-edited role such as GridCrest's keeps its edits):

* Admin, Supervisor: full CRUD (same as Branding).
* Agent, Requestor and every custom role: an explicit no-access row (the frontend
  checks permission keys exactly; the explicit row keeps the backend, which inherits
  from ``itsm.admin``, consistent with the UI).

On a freshly provisioned org the roles don't exist yet at migrate time, so this only
creates the bare module and ``seed_rbac`` (registry) wires parent + grants.
Literal values — migrations never import the registry.
"""

from django.db import migrations

FULL = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
NONE = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}

CODE = "itsm.admin.interface"
GRANTS = {"admin": FULL, "supervisor": FULL}


def seed_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    parent = Module.objects.filter(code="itsm.admin").first()
    module, _ = Module.objects.update_or_create(
        code=CODE,
        defaults={
            "name": "Interface (Classic / Modern)",
            "description": (
                "Set the organisation's default interface for agents (Classic or Modern), "
                "whether agents may switch themselves, and the date Classic is retired."
            ),
            "category": "administration",
            "sort_order": 906,
            "is_active": True,
            "parent": parent,
        },
    )
    for role in SystemRole.objects.filter(is_deleted=False):
        RoleModulePermission.objects.get_or_create(
            role=role, module=module, defaults=dict(GRANTS.get(role.code, NONE)))


def drop_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")
    RoleModulePermission.objects.filter(module__code=CODE).delete()
    Module.objects.filter(code=CODE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0016_tenantinterfaceconfig"),
    ]

    operations = [migrations.RunPython(seed_module, drop_module)]
