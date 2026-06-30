from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_helpdesks", "0002_helpdesk_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="helpdesk",
            name="notification_from_name",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Display name on the From header of notification emails.",
                max_length=150,
            ),
        ),
        migrations.AddField(
            model_name="helpdesk",
            name="notification_from_email",
            field=models.EmailField(
                blank=True,
                default="",
                help_text="From address for notification emails. Used only when the "
                "project has no outbound mailbox; blank ⇒ the global default is used.",
                max_length=254,
            ),
        ),
    ]
