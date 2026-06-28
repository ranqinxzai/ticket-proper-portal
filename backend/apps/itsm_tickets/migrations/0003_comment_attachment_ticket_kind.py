# Generated for the RTE comment composer (inline images + file attachments).

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_tickets', '0002_ticket_updated_by'),
    ]

    operations = [
        # An attachment is uploaded before its comment exists, so `comment` is now
        # nullable and a `ticket` FK scopes the orphan (path + access control).
        migrations.AddField(
            model_name='commentattachment',
            name='ticket',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='comment_attachments', to='itsm_tickets.ticket'),
        ),
        migrations.AddField(
            model_name='commentattachment',
            name='kind',
            field=models.CharField(choices=[('file', 'File'), ('image', 'Inline image')], default='file', max_length=8),
        ),
        migrations.AlterField(
            model_name='commentattachment',
            name='comment',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='attachments', to='itsm_tickets.comment'),
        ),
    ]
