from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_user_auth_method_ms_object_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="ui_preference",
            field=models.CharField(blank=True, default="", max_length=10),
        ),
    ]
