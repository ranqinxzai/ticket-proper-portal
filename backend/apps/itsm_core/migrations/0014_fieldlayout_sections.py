from django.db import migrations, models


class Migration(migrations.Migration):
    """Declared layout sections (incl. empty ones) — see FieldLayout.sections.
    Schema-only: existing layouts get [] and keep deriving sections from items."""

    dependencies = [
        ("itsm_core", "0013_alter_auditevent_action"),
    ]

    operations = [
        migrations.AddField(
            model_name="fieldlayout",
            name="sections",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
