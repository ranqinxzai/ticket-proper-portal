"""Make four never-checked modules enforceable without changing anyone's access.

Until 2026-10-18 these modules existed in the role matrix but no endpoint checked them:

=======================  ========  ===============================================
module                   bit       what the endpoint checked until now
=======================  ========  ===============================================
itsm.tickets.create      create    ``itsm.tickets`` create        (POST /tickets/)
itsm.reports.sla         read      ``itsm.reports`` read          (SLA reports)
itsm.reports.agent       read      ``itsm.reports`` read          (agent performance)
itsm.portal.approvals    read      nothing — any signed-in user   (approvals inbox)
=======================  ========  ===============================================

They are now enforced. This migration writes, for EVERY role, an explicit row on each
of the four modules whose enforced bit equals what the role effectively has TODAY, so
nobody gains or loses access on deploy (works from live data — hand-edited roles such
as GridCrest's are handled, not seed assumptions).

* Existing (alive) row: only the enforced bit is touched; the other bits are kept.
* Missing row: created with the other three bits = the module's current *inherited*
  effective bits (closest ancestor with an explicit row wins, exactly like
  ``services.check_permission``), so no other answer changes. A soft-deleted row is
  revived (the ``(role, module)`` unique constraint covers deleted rows).

Why write a row even where inheritance already gives the right answer: the role
matrix shows — and its Save re-sends — only explicit rows. An inherited True renders
unticked and the next Save would silently write False. Materialising keeps the matrix,
the backend and the frontend's exact-key ``hasPerm`` in agreement.

Idempotent, per-schema. A freshly created schema has no modules yet at migrate time
(``seed_rbac`` runs afterwards, and its registry defaults match these outcomes), so
this is a no-op there. Reverse is a no-op.
"""

from django.db import migrations

_ACTIONS = ("read", "create", "update", "delete")

# (module, enforced action, (source module, source action) | None ⇒ always True)
TARGETS = [
    ("itsm.tickets.create", "create", ("itsm.tickets", "create")),
    ("itsm.reports.sla", "read", ("itsm.reports", "read")),
    ("itsm.reports.agent", "read", ("itsm.reports", "read")),
    ("itsm.portal.approvals", "read", None),
]


def _chain(code):
    parts = code.split(".")
    return [".".join(parts[:i]) for i in range(len(parts), 0, -1)]


def _effective(rows, code, action):
    """Mirror of services.check_permission (closest ancestor with a row decides)."""
    for c in _chain(code):
        if c in rows:
            return bool(getattr(rows[c], f"can_{action}"))
    return False


def backfill(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    SystemRole = apps.get_model("itsm_rbac", "SystemRole")
    RPM = apps.get_model("itsm_rbac", "RoleModulePermission")

    modules = {
        m.code: m
        for m in Module._base_manager.filter(
            code__in=[t[0] for t in TARGETS], is_deleted=False
        )
    }
    if not modules:
        return  # fresh schema — seed_rbac grants the registry defaults later

    written = 0
    for role in SystemRole._base_manager.filter(is_deleted=False):
        alive = {
            r.module.code: r
            for r in RPM._base_manager.filter(role=role, is_deleted=False).select_related("module")
        }
        for code, action, source in TARGETS:
            mod = modules.get(code)
            if mod is None:
                continue
            want = True if source is None else _effective(alive, *source)
            field = f"can_{action}"
            row = alive.get(code)
            if row is not None:
                if bool(getattr(row, field)) != want:
                    setattr(row, field, want)
                    row.save(update_fields=[field, "updated_at"])
                    written += 1
                continue
            bits = {f"can_{a}": _effective(alive, code, a) for a in _ACTIONS}
            bits[field] = want
            dead = RPM._base_manager.filter(role=role, module=mod).first()
            if dead is not None:
                for k, v in bits.items():
                    setattr(dead, k, v)
                dead.is_deleted = False
                dead.deleted_at = None
                dead.save()
            else:
                RPM._base_manager.create(role=role, module=mod, **bits)
            written += 1

    if written:
        from django.core.cache import cache

        cache.clear()  # permission cache (5 min); LocMem is per-process but be correct anyway


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0013_seed_branding_module"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
