# Generated for the per-status "Exclude from SLA calculation" flag (Status.pauses_sla).
# A ticket entering a status with pauses_sla=True pauses all its running SLA clocks
# (honored in itsm_sla.services.sla_engine.on_status_change). Non-destructive:
# backfills every existing Status row with False. Runs once per tenant schema.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_workflows', '0004_incident_resolution_screen'),
    ]

    operations = [
        migrations.AddField(
            model_name='status',
            name='pauses_sla',
            field=models.BooleanField(default=False),
        ),
    ]
