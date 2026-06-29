from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_user_manager'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='auth_method',
            field=models.CharField(
                choices=[('password', 'Password'), ('microsoft', 'Microsoft (SSO)')],
                default='password',
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='ms_object_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
    ]
