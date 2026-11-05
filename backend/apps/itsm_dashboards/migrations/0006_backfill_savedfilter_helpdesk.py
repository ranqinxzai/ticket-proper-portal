"""Attribute existing cross-project (All-Tickets) saved views to a helpdesk (S5).

Before 2026-10-18 a view saved from a helpdesk's All Tickets queue was stored with
``project=null`` and nothing recorded WHICH helpdesk, so shared ones reached every
user in the tenant and personal ones showed in every queue. Runtime scoping now keys
off ``SavedFilter.helpdesk``. For every row with ``project IS NULL AND helpdesk IS
NULL`` (per tenant schema) the first rule that yields exactly one helpdesk wins:

1. the tenant has exactly one (non-deleted) helpdesk → it;
2. the filter's spec names projects (legacy ``project`` key or a ``project``
   eq/in condition) and they all belong to one helpdesk → it;
3. the owner is an active member of exactly one helpdesk → it;
4. otherwise the row stays NULL — an "unscoped legacy" view, visible to its OWNER
   only (in every All Tickets queue they open); a shared one stops reaching others
   until the owner re-saves it from the right helpdesk.

Project-scoped rows are untouched (their helpdesk is ``project.helpdesk``). Prints the
per-schema counts. Idempotent (only NULL rows are considered); reverse is a no-op.
"""

import uuid

from django.db import connection, migrations


def _uuid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def _spec_project_ids(spec):
    spec = spec if isinstance(spec, dict) else {}
    ids = set()
    if spec.get("project") and (pid := _uuid(spec["project"])):
        ids.add(pid)
    for cond in spec.get("conditions") or []:
        if not isinstance(cond, dict) or cond.get("field") != "project":
            continue
        if cond.get("op") not in ("eq", "in"):
            continue
        value = cond.get("value")
        for v in value if isinstance(value, list) else [value]:
            if (pid := _uuid(v)):
                ids.add(pid)
    return ids


def backfill(apps, schema_editor):
    SavedFilter = apps.get_model("itsm_dashboards", "SavedFilter")
    Helpdesk = apps.get_model("itsm_helpdesks", "Helpdesk")
    HelpdeskMembership = apps.get_model("itsm_helpdesks", "HelpdeskMembership")
    Project = apps.get_model("itsm_projects", "Project")

    rows = list(SavedFilter._base_manager.filter(project__isnull=True, helpdesk__isnull=True))
    if not rows:
        return
    helpdesk_ids = list(
        Helpdesk._base_manager.filter(is_deleted=False).values_list("id", flat=True)
    )
    only = helpdesk_ids[0] if len(helpdesk_ids) == 1 else None
    counts = {"only_helpdesk": 0, "spec_project": 0, "owner_membership": 0, "unscoped": 0}

    for sf in rows:
        target, rule = None, None
        if only is not None:
            target, rule = only, "only_helpdesk"
        if target is None:
            pids = _spec_project_ids(sf.query_spec)
            if pids:
                hds = set(
                    Project._base_manager.filter(pk__in=pids).values_list("helpdesk_id", flat=True)
                )
                if len(hds) == 1:
                    target, rule = hds.pop(), "spec_project"
        if target is None and sf.owner_id:
            hds = list(
                HelpdeskMembership._base_manager.filter(
                    user_id=sf.owner_id, is_active=True, is_deleted=False,
                    helpdesk__is_deleted=False,
                ).values_list("helpdesk_id", flat=True).distinct()
            )
            if len(hds) == 1:
                target, rule = hds[0], "owner_membership"
        if target is None:
            counts["unscoped"] += 1
            continue
        sf.helpdesk_id = target
        sf.save(update_fields=["helpdesk"])
        counts[rule] += 1

    print(  # noqa: T201 — deploy-time visibility of the backfill's effect per tenant
        f"\n    [{getattr(connection, 'schema_name', '?')}] saved views scoped: "
        f"only-helpdesk={counts['only_helpdesk']} spec-project={counts['spec_project']} "
        f"owner-membership={counts['owner_membership']} left-unscoped={counts['unscoped']}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_dashboards", "0005_savedfilter_helpdesk"),
        ("itsm_projects", "0010_project_type_problem"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
