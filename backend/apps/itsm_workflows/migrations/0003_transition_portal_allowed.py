# Generated for the "Allowed from portal" transition flag (e.g. Reopen from the Service Portal).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_workflows', '0002_transition_note_prompt'),
    ]

    operations = [
        migrations.AddField(
            model_name='transition',
            name='portal_allowed',
            field=models.BooleanField(default=False),
        ),
    ]
