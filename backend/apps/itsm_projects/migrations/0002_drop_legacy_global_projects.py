# Greenfield reseed — step 1 of 2.
# Drop the legacy GLOBAL Incident/Request projects (keys INC/REQ) and their
# PROTECTed dependents so the projects table is empty before the mandatory
# `helpdesk` FK is added in 0003. The DELETEs MUST commit in their own migration
# (separate transaction) — doing the deletes and the ALTER TABLE together trips
# Postgres' "cannot ALTER TABLE … because it has pending trigger events".
# Guarded so a fresh database (no legacy rows) simply no-ops.

from django.db import migrations


def drop_legacy_projects(apps, schema_editor):
    Project = apps.get_model("itsm_projects", "Project")
    legacy = Project.objects.filter(key__in=["INC", "REQ"])
    if not legacy.exists():
        return  # fresh DB — nothing to clean up

    # Clear PROTECT FKs first (EmailChannel.project / Ticket.project are PROTECT).
    for app_label, model_name in (("itsm_email", "EmailChannel"), ("itsm_tickets", "Ticket")):
        try:
            Model = apps.get_model(app_label, model_name)
        except LookupError:
            continue
        Model.objects.filter(project__key__in=["INC", "REQ"]).delete()

    # CASCADE clears TicketSequence / TicketType / templates / routing rules /
    # project-scoped SLA & notification schemes hanging off these projects.
    legacy.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_groups', '0003_group_helpdesk'),
        ('itsm_helpdesks', '0001_initial'),
        ('itsm_projects', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(drop_legacy_projects, migrations.RunPython.noop),
    ]
