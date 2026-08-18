from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_helpdesks", "0003_helpdesk_notification_from"),
    ]

    operations = [
        migrations.AddField(
            model_name="helpdesk",
            name="combined_queue_columns",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
