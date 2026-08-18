"""Backfill Agent READ on itsm.fields.layouts + itsm.workflows.transitions.

The default Agent seed granted read on the parent modules (`itsm.fields`,
`itsm.workflows`) but omitted these two *children* from ``AGENT_RO_MODULES``, so a
seeded Agent got an explicit ``read=False`` row on them. Because permission
resolution stops at the closest ancestor WITH an explicit row — even a False one
(see ``services.check_permission``) — the agent could not read the layout /
transitions, which 403s the ticket **create/detail** form's layout-resolve call
(``GET /field-layouts/resolve/`` → module ``itsm.fields.layouts``) and renders the
form with **zero fields** (a blank body). The registry seed lists now include both
children (fresh tenants fixed at provision time); this backfills already-seeded
schemas on the next ``migrate_schemas`` run.

Idempotent and per-schema. Touches ONLY the **Agent** role's **read** bit on those
two modules — never other roles, never other bits, never other modules — so
hand-edited grants (e.g. a customised Supervisor) are left untouched. On a freshly
created schema the role/modules are seeded *after* migrations by
``provision_org`` → ``seed_itsm``, so the lookups return nothing here and
``seed_rbac`` supplies the grant.
"""

from django.db import migrations

AGENT_READ_CODES = ("itsm.fields.layouts", "itsm.workflows.transitions")


def grant_agent_read(apps, schema_editor):
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    Module = apps.get_model("itsm_rbac", "Module")
    RoleModulePermission = apps.get_model("itsm_rbac", "RoleModulePermission")

    agent = SystemRole.objects.filter(code="agent").first()
    if agent is None:
        return  # fresh schema — seed_rbac grants it later

    for code in AGENT_READ_CODES:
        module = Module.objects.filter(code=code).first()
        if module is None:
            continue
        perm, created = RoleModulePermission.objects.get_or_create(
            role=agent, module=module,
            defaults={"can_read": True, "can_create": False,
                      "can_update": False, "can_delete": False},
        )
        # Existing row: flip only the read bit so any hand-edited create/update/delete survive.
        if not created and not perm.can_read:
            perm.can_read = True
            perm.save(update_fields=["can_read", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0010_seed_tickets_print_module"),
    ]

    # Reverse is a no-op: revoking layout/transition read from Agent would re-break the
    # create form and is never desirable on a rollback.
    operations = [migrations.RunPython(grant_agent_read, migrations.RunPython.noop)]
