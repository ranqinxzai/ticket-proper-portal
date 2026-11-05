"""Seed the ``itsm.approvals.send`` permission module and its grants (idempotent, per org).

"Send for approval" (2026-10-24): an agent starts an approval from a status that
allows it, picking the approvers of On-fly stages, and can withdraw what they sent.
Delete = withdraw approvals other people sent.

Grants — create-only (``get_or_create`` never overwrites an existing row, so a
hand-edited role such as GridCrest's keeps its edits):

* Admin, Supervisor: full CRUD.
* Agent: read/create/update (send + withdraw own), no delete.
* Requestor and every custom role: an explicit no-access row. The frontend checks
  permission keys exactly, so a missing row would read as "no" anyway; an explicit
  row keeps the backend (which inherits from ``itsm.approvals``) consistent with the UI.

On a freshly provisioned org the roles don't exist yet at migrate time, so this
only creates the bare module and ``seed_rbac`` (registry) wires parent + grants.
Literal values — migrations never import the registry.
"""

from django.db import migrations

FULL = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
RWC = {"can_read": True, "can_create": True, "can_update": True, "can_delete": False}
NONE = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}

CODE = "itsm.approvals.send"
GRANTS = {"admin": FULL, "supervisor": FULL, "agent": RWC}


def seed_module(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    parent = Module.objects.filter(code="itsm.approvals").first()
    module, _ = Module.objects.update_or_create(
        code=CODE,
        defaults={
            "name": "Send for Approval",
            "description": (
                "Create lets the user send a ticket for approval from a status that allows "
                "it, picking the approvers of On-fly stages. Delete also lets them withdraw "
                "approvals other people sent (anyone can withdraw their own)."
            ),
            "category": "operations",
            "sort_order": 252,
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
        ("itsm_rbac", "0014_backfill_enforced_module_grants"),
    ]

    operations = [migrations.RunPython(seed_module, drop_module)]
