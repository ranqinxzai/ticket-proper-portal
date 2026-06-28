from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_notifications', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='notificationoutbox',
            name='rendered_html',
            field=models.TextField(blank=True, default=''),
        ),
    ]
