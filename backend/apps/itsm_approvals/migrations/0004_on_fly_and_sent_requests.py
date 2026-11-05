"""On-fly approvers + sent requests (2026-10-24).

- ``ApprovalStage``: new approver type ``on_the_fly`` with ``on_fly_pool`` (any user /
  group / listed users) and ``candidate_users``.
- ``ApprovalRequest``: ``source`` (existing rows → ``policy``, exactly how they ran),
  ``note``, ``return_status`` and ``waiting_status`` (sent requests only).
- ``ApprovalRequestApprover``: the people the sender picked per On-fly stage.

Schema only; runs per tenant schema via ``migrate_schemas``.
"""

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_approvals', '0003_request_mode_stage_ids_live_level_unique'),
        ('itsm_workflows', '0010_status_send_for_approval'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='approvalrequest',
            name='note',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='approvalrequest',
            name='return_status',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='itsm_workflows.status'),
        ),
        migrations.AddField(
            model_name='approvalrequest',
            name='source',
            field=models.CharField(choices=[('policy', 'Workflow / catalog'), ('sent', 'Sent by an agent')], default='policy', max_length=8),
        ),
        migrations.AddField(
            model_name='approvalrequest',
            name='waiting_status',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='itsm_workflows.status'),
        ),
        migrations.AddField(
            model_name='approvalstage',
            name='candidate_users',
            field=models.ManyToManyField(blank=True, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='approvalstage',
            name='on_fly_pool',
            field=models.CharField(blank=True, choices=[('any_user', 'Any user'), ('group', 'Members of a group'), ('listed_users', 'Listed users')], default='', max_length=16),
        ),
        migrations.AlterField(
            model_name='approvalstage',
            name='approver_type',
            field=models.CharField(choices=[('specific_user', 'Specific user'), ('role', 'Anyone with role'), ('group', 'Anyone in group'), ('requestor_manager', "Requestor's manager"), ('on_the_fly', 'On fly (agent picks)')], max_length=20),
        ),
        migrations.CreateModel(
            name='ApprovalRequestApprover',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('approval_request', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='picked_approvers', to='itsm_approvals.approvalrequest')),
                ('deleted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('stage', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='itsm_approvals.approvalstage')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='approvalrequestapprover',
            constraint=models.UniqueConstraint(condition=models.Q(('is_deleted', False)), fields=('approval_request', 'stage', 'user'), name='uniq_approval_request_stage_picked_user'),
        ),
    ]
