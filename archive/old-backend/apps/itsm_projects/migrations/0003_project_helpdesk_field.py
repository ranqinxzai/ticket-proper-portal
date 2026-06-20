# Greenfield reseed — step 2 of 2.
# Add the now-mandatory `helpdesk` FK (safe: the projects table is empty after
# 0002 dropped the legacy globals), plus the per-helpdesk index and the
# one-default-each partial unique constraint. The per-helpdesk projects
# (ITINC/ITREQ/HRINC/HRREQ) are (re)created by `manage.py seed_itsm`.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_helpdesks', '0001_initial'),
        ('itsm_projects', '0002_drop_legacy_global_projects'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='helpdesk',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='projects', to='itsm_helpdesks.helpdesk'),
        ),
        migrations.AddIndex(
            model_name='project',
            index=models.Index(fields=['helpdesk', 'status'], name='itsm_projec_helpdes_a75c16_idx'),
        ),
        migrations.AddConstraint(
            model_name='project',
            constraint=models.UniqueConstraint(condition=models.Q(('is_deleted', False), ('project_type__in', ['incident', 'service_request'])), fields=('helpdesk', 'project_type'), name='uniq_helpdesk_default_projecttype'),
        ),
    ]
