# Generated for the per-project assignment-group whitelist.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_projects', '0004_project_default_view_key_project_disabled_view_keys'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='allowed_group_ids',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
