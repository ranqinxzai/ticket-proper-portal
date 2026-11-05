from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_helpdesks", "0004_helpdesk_combined_queue_columns"),
    ]

    operations = [
        migrations.AddField(
            model_name="helpdesk",
            name="combined_default_view_key",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="helpdesk",
            name="combined_disabled_view_keys",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
