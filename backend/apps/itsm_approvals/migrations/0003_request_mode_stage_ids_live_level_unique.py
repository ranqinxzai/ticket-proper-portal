"""Parallel approvals + re-addable stage levels (2026-10-18, B3).

- ``ApprovalRequest.mode`` / ``stage_ids``: snapshots taken when a request starts.
  Existing rows get ``mode="sequential"`` and ``stage_ids=[]``, which is exactly how
  they already ran (parallel mode was never implemented before this change).
- ``ApprovalStage``: the full ``UniqueConstraint(workflow, level)`` becomes a partial
  one over live rows (``is_deleted=False``). Every existing row already satisfies the
  stricter constraint, so the new one is valid on all tenant data.

Schema only; runs per tenant schema via ``migrate_schemas``.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_approvals", "0002_approvalworkflow_project"),
    ]

    operations = [
        migrations.AddField(
            model_name="approvalrequest",
            name="mode",
            field=models.CharField(
                choices=[("sequential", "Sequential (one level after another)"),
                         ("parallel", "Parallel (all levels at once)")],
                default="sequential", max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="approvalrequest",
            name="stage_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RemoveConstraint(
            model_name="approvalstage",
            name="uniq_approval_workflow_level",
        ),
        migrations.AddConstraint(
            model_name="approvalstage",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_deleted", False)),
                fields=("workflow", "level"),
                name="uniq_approval_workflow_live_level",
            ),
        ),
    ]
