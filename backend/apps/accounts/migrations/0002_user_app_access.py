from django.db import migrations, models

import apps.accounts.models


def grant_all_existing(apps_registry, schema_editor):
    User = apps_registry.get_model("accounts", "User")
    for u in User.objects.all():
        if not u.app_access:
            u.app_access = ["qa", "pm"]
            u.save(update_fields=["app_access"])


def noop_reverse(apps_registry, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="app_access",
            field=models.JSONField(
                blank=True,
                default=apps.accounts.models.default_app_access,
            ),
        ),
        migrations.RunPython(grant_all_existing, noop_reverse),
    ]
