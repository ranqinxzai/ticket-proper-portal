"""Backfill per-user project access for existing data.

Phase-4 introduces a **strict-whitelist** project clamp: a user only sees a
project when they hold a ``ProjectMembership``. To avoid every current agent
losing their project tabs on deploy, grant each active helpdesk member access to
all that helpdesk's active projects (the prior implicit behaviour, now explicit
and editable). Idempotent; runs per-schema under ``migrate_schemas``. On a fresh
schema the tables are empty so this no-ops, and ``seed_project_memberships``
grants access after the seed instead.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    HelpdeskMembership = apps.get_model("itsm_helpdesks", "HelpdeskMembership")
    Project = apps.get_model("itsm_projects", "Project")
    ProjectMembership = apps.get_model("itsm_projects", "ProjectMembership")

    by_hd: dict = {}
    for pid, hd_id in (
        Project.objects.filter(is_deleted=False, status="active")
        .values_list("id", "helpdesk_id")
    ):
        by_hd.setdefault(hd_id, []).append(pid)

    for user_id, hd_id in (
        HelpdeskMembership.objects.filter(
            is_active=True, is_deleted=False,
            helpdesk__status="active", helpdesk__is_deleted=False,
        ).values_list("user_id", "helpdesk_id")
    ):
        for pid in by_hd.get(hd_id, []):
            ProjectMembership.objects.get_or_create(
                project_id=pid, user_id=user_id, defaults={"is_active": True},
            )


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_projects", "0006_projectmembership"),
        ("itsm_helpdesks", "0001_initial"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
