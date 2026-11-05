import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("itsm_rbac", "0015_seed_approvals_send_module"),
    ]

    operations = [
        migrations.CreateModel(
            name="TenantInterfaceConfig",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(db_index=True, default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("ui_default", models.CharField(choices=[("classic", "Classic"), ("modern", "Modern")], default="classic", max_length=10)),
                ("ui_allow_switch", models.BooleanField(default=True)),
                ("ui_classic_retire_on", models.DateField(blank=True, null=True)),
                ("deleted_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Tenant interface configuration",
            },
        ),
    ]
