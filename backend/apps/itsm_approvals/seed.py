"""Seed a sample multi-level approval workflow and gate the Request workflow.

Runs after RBAC/workflows/projects so the SystemRole + Request workflow exist.
Idempotent: keyed on natural names."""

from __future__ import annotations


def run():
    from apps.itsm_rbac.models import SystemRole
    from apps.itsm_workflows.models import Transition, TransitionCondition, Workflow

    from .models import ApprovalStage, ApprovalWorkflow

    # 1) A reusable 2-level approval policy.
    wf, _ = ApprovalWorkflow.objects.get_or_create(
        name="Standard Procurement Approval",
        defaults={"description": "Two-level sign-off for service requests that need approval.",
                  "mode": "sequential", "is_active": True},
    )
    agent_role = SystemRole.objects.filter(code="agent").first()
    sup_role = SystemRole.objects.filter(code="supervisor").first()
    ApprovalStage.objects.get_or_create(
        workflow=wf, level=1,
        defaults={"name": "Level One Approval", "approver_type": "role",
                  "approver_role": agent_role, "rule": "any", "min_approvals": 1},
    )
    ApprovalStage.objects.get_or_create(
        workflow=wf, level=2,
        defaults={"name": "Level Two Approval", "approver_type": "role",
                  "approver_role": sup_role, "rule": "any", "min_approvals": 1},
    )

    # 2) Gate the default Request workflow's transition INTO an "approved" status with
    #    an `approval_granted` condition. Backward-compatible: the condition passes when
    #    no approval is pending, so requests without an approval still flow normally.
    gated = 0
    for w in Workflow.objects.filter(base_type="service_request", is_deleted=False):
        for tr in Transition.objects.filter(workflow=w, to_status__key="approved", is_deleted=False):
            _, created = TransitionCondition.objects.get_or_create(
                transition=tr, condition_type="approval_granted",
                defaults={"config": {}, "negate": False},
            )
            gated += int(created)

    return {"approval_workflows": 1, "stages": 2, "gated_transitions": gated}
