"""Seed the three asset permission modules and their grants (idempotent, per org).

* ``itsm.assets`` (Screens): the register, dashboard and report.
* ``itsm.assets.import`` (Screens): Excel import.
* ``itsm.assets.config`` (Settings): categories, fields, statuses and the
  Vendor / Location / Department masters.

Grants — create-only (``get_or_create`` never overwrites an existing row, so a
hand-edited role such as GridCrest's keeps its edits):

* Admin, Supervisor: full CRUD on all three.
* Agent: Assets read/create/update (no delete); Import none; Configuration read.
* Requestor and every custom role: an explicit no-access row. The frontend checks
  permission keys exactly, so a missing row would read as "no" anyway; an explicit
  row keeps the backend (which inherits from ``itsm``) consistent with the UI.

On a freshly provisioned org the roles don't exist yet at migrate time, so this
only creates the bare modules and ``seed_rbac`` (registry) wires parents + grants.
Literal values — migrations never import the registry.
"""

from django.db import migrations

FULL = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
RWC = {"can_read": True, "can_create": True, "can_update": True, "can_delete": False}
READ = {"can_read": True, "can_create": False, "can_update": False, "can_delete": False}
NONE = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}

# code, name, parent, sort, category, description
MODULES = [
    ("itsm.assets", "Assets", "itsm", 260, "operations",
     "Read opens the Assets section (Asset Dashboard, Asset List, Asset Report). Create, "
     "Update and Delete add, edit and delete assets."),
    ("itsm.assets.import", "Asset Import", "itsm.assets", 261, "operations",
     "Create imports assets from Excel (template download, check and import). Read opens "
     "the import history and failed rows."),
    ("itsm.assets.config", "Asset Configuration", "itsm.assets", 262, "administration",
     "Categories and sub-categories with their detail fields, statuses, and the Vendor, "
     "Location and Department lists. Read is enough to view them."),
]
GRANTS = {
    "admin": {"itsm.assets": FULL, "itsm.assets.import": FULL, "itsm.assets.config": FULL},
    "supervisor": {"itsm.assets": FULL, "itsm.assets.import": FULL, "itsm.assets.config": FULL},
    "agent": {"itsm.assets": RWC, "itsm.assets.import": NONE, "itsm.assets.config": READ},
}


def seed_modules(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    by_code = {}
    for code, name, parent_code, order, category, description in MODULES:
        parent = by_code.get(parent_code) or Module.objects.filter(code=parent_code).first()
        module, _ = Module.objects.update_or_create(
            code=code,
            defaults={"name": name, "description": description, "category": category,
                      "sort_order": order, "is_active": True, "parent": parent},
        )
        by_code[code] = module

    for role in SystemRole.objects.filter(is_deleted=False):
        bits_by_code = GRANTS.get(role.code, {})
        for code, module in by_code.items():
            RoleModulePermission.objects.get_or_create(
                role=role, module=module, defaults=dict(bits_by_code.get(code, NONE)))


def drop_modules(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")
    codes = [m[0] for m in MODULES]
    RoleModulePermission.objects.filter(module__code__in=codes).delete()
    Module.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_assets", "0002_default_statuses"),
        ("itsm_rbac", "0014_backfill_enforced_module_grants"),
    ]

    operations = [migrations.RunPython(seed_modules, drop_modules)]
