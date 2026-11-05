"""Send for approval — per-status flag + waiting status (2026-10-24).

``Status.allows_send_for_approval`` lets agents start an approval from a status;
``Status.approval_waiting_status`` is where the ticket waits while it's pending (null
= it stays put). Both default off/empty, so existing workflows are unchanged.

Schema only; runs per tenant schema via ``migrate_schemas``.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_workflows', '0009_request_rejected_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='status',
            name='allows_send_for_approval',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='status',
            name='approval_waiting_status',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='itsm_workflows.status'),
        ),
    ]
