import apps.itsm_rbac.models
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('itsm_rbac', '0011_grant_agent_layout_transition_read'),
    ]

    operations = [
        migrations.CreateModel(
            name='TenantBrandingConfig',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('client_name', models.CharField(blank=True, default='', max_length=120)),
                ('logo', models.ImageField(blank=True, null=True, upload_to=apps.itsm_rbac.models.branding_logo_path)),
                ('address', models.TextField(blank=True, default='')),
                ('website', models.URLField(blank=True, default='')),
                ('email', models.EmailField(blank=True, default='', max_length=254)),
                ('deleted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Tenant branding configuration',
            },
        ),
    ]
