import apps.itsm_email.crypto
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('itsm_rbac', '0002_seed_admin_role'),
    ]

    operations = [
        migrations.CreateModel(
            name='TenantSSOConfig',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('enabled', models.BooleanField(default=False)),
                ('microsoft_client_id', models.CharField(blank=True, default='', max_length=255)),
                ('microsoft_client_secret_enc', apps.itsm_email.crypto.EncryptedField(blank=True, default='')),
                ('microsoft_tenant_id', models.CharField(blank=True, default='', max_length=128)),
                ('auto_provision', models.BooleanField(default=True)),
                ('allowed_email_domains', models.CharField(blank=True, default='', max_length=500)),
                ('deleted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Tenant SSO configuration',
            },
        ),
    ]
