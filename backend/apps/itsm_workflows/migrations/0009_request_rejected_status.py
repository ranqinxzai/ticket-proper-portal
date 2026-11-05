"""Rejected request status (2026-10-18, user decision).

For every tenant's seeded Default Request Workflow (``base_type="service_request"``,
``is_default=True``) add:
  • status ``rejected`` ("Rejected", Done category, red) — the terminal state a
    request lands in when its approval is rejected;
  • transition "Reject" ``new → rejected`` with post-functions stop the resolution
    SLA + stamp ``closed_at``, gated by the ``approval_rejected`` condition (true only
    when the ticket's latest non-cancelled approval request is rejected) so agents
    can't use it to bypass approval. itsm_approvals runs it automatically (system
    actor) on a rejection, finding it by ``to_status.key == "rejected"``.

Idempotent and safe on existing data: a workflow that already has ANY status row keyed
``rejected`` (live or soft-deleted — the (workflow, key) constraint covers both) is
skipped untouched, as is one without a live ``new`` status. No existing row is
modified. Runs once per tenant schema. Mirrors ``seed.py`` (REQUEST_STATUSES /
REQUEST_TRANSITIONS / ``ensure_reject_gate``) for new orgs.

Also lists the two approval condition types in ``TransitionCondition.condition_type``
choices (choices only — no data change).
"""

from __future__ import annotations

from django.db import migrations, models

STOP_AND_STAMP = [
    {"type": "stop_sla", "config": {"metric": "resolution"}},
    {"type": "stamp_timestamp", "config": {"field": "closed_at"}},
]


def forward(apps, schema_editor):
    Workflow = apps.get_model("itsm_workflows", "Workflow")
    Status = apps.get_model("itsm_workflows", "Status")
    StatusCategory = apps.get_model("itsm_workflows", "StatusCategory")
    Transition = apps.get_model("itsm_workflows", "Transition")
    TransitionCondition = apps.get_model("itsm_workflows", "TransitionCondition")

    done = StatusCategory.objects.filter(key="done").first()
    if done is None:
        return  # an unseeded schema (no categories) has no workflows to extend
    added = skipped = 0
    for wf in Workflow.objects.filter(base_type="service_request", is_default=True, is_deleted=False):
        if Status.objects.filter(workflow=wf, key="rejected").exists():
            skipped += 1
            continue
        new = Status.objects.filter(workflow=wf, key="new", is_deleted=False).first()
        if new is None:
            skipped += 1
            continue
        live = Status.objects.filter(workflow=wf, is_deleted=False)
        last = live.order_by("-sort_order").first()
        rejected = Status.objects.create(
            workflow=wf, key="rejected", name="Rejected", category=done, color="#dc2626",
            sort_order=(last.sort_order + 10) if last else 60, is_initial=False,
            canvas_x=80 + live.count() * 200, canvas_y=120,
        )
        last_tr = Transition.objects.filter(workflow=wf, is_deleted=False).order_by("-sort_order").first()
        tr = Transition.objects.create(
            workflow=wf, name="Reject", from_status=new, to_status=rejected,
            sort_order=(last_tr.sort_order + 10) if last_tr else 90,
            post_functions=[dict(pf) for pf in STOP_AND_STAMP],
        )
        TransitionCondition.objects.create(
            transition=tr, condition_type="approval_rejected", config={}, negate=False,
        )
        added += 1
    if added or skipped:
        print(f"  itsm_workflows.0009 [{getattr(schema_editor.connection, 'schema_name', '')}]: "
              f"Rejected added to {added} request workflow(s), skipped {skipped}")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_workflows", "0008_workflow_base_type_problem"),
    ]

    operations = [
        migrations.AlterField(
            model_name="transitioncondition",
            name="condition_type",
            field=models.CharField(
                choices=[
                    ("role_in", "User has role"),
                    ("group_member", "User is in assigned group"),
                    ("is_assignee", "User is the assignee"),
                    ("field_equals", "Field equals value"),
                    ("approval_granted", "Approval granted (or none pending)"),
                    ("approval_rejected", "Latest approval rejected"),
                ],
                max_length=30,
            ),
        ),
        migrations.RunPython(forward, noop),
    ]
