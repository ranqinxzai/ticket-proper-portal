"""Approvals bug-fix batch (2026-10-18): B1 (no silent freeze), B2 (gate after a
rejection), B3 (parallel mode, inactive policies, re-addable levels), U2 (can_decide),
U3 (reject reason), U7 (names), A1/A2 (start permission + list clamp), G4 events,
`pending_approver_users`, and the auto-move to a Rejected status."""

from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_approvals.models import ApprovalAction, ApprovalRequest, ApprovalStage, ApprovalWorkflow
from apps.itsm_approvals.services import engine as approval_engine
from apps.itsm_projects.models import Project
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Status, StatusCategory, Transition, TransitionCondition
from apps.itsm_workflows.services import engine

User = get_user_model()


def _seed():
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_projects.seed import run as seed_projects
    from apps.itsm_rbac.registry import seed_rbac
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_rbac()
    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


def _reset_bot_cache():
    try:
        from apps.itsm_automation.services.system_user import reset_cache
        reset_cache()
    except ImportError:  # pragma: no cover
        pass


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        _seed()

    def setUp(self):
        _reset_bot_cache()
        self.root = User.objects.create_superuser(username="root", password="x")
        self.boss = User.objects.create_user(username="boss", password="x", full_name="Bea Boss")
        self.alice = User.objects.create_user(username="alice", password="x", full_name="Alice Approver")
        self.bob = User.objects.create_user(username="bob", password="x", full_name="Bob Approver")
        self.req_user = User.objects.create_user(username="req", password="x", manager=self.boss)
        self.project = Project.objects.get(helpdesk__key="IT", project_type="service_request")
        self.wf = self.project.default_workflow
        self.approve_tr = Transition.objects.get(workflow=self.wf, name="Approve")
        self.start_fulfilment = Transition.objects.get(workflow=self.wf, name="Start Fulfilment")
        self.awf = ApprovalWorkflow.objects.create(name="Manager sign-off", project=self.project)

    # helpers
    def stage(self, awf=None, level=1, name="Manager", **kw):
        kw.setdefault("approver_type", "requestor_manager")
        return ApprovalStage.objects.create(workflow=awf or self.awf, level=level, name=name, **kw)

    def ticket(self, requestor=None):
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.create_ticket(
                project=self.project, ticket_type=self.project.ticket_types.first(),
                summary="Need a laptop", priority="p3", user=self.root,
                requestor=requestor or self.req_user, apply_routing=False,
            )

    def wire_start(self, tr=None, awf=None):
        tr = tr or self.approve_tr
        tr.post_functions = [pf for pf in (tr.post_functions or []) if pf.get("type") != "request_approval"]
        tr.post_functions.append({"type": "request_approval", "config": {"workflow_id": str((awf or self.awf).id)}})
        tr.save(update_fields=["post_functions"])
        return tr

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def transition_api(self, user, t, tr):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client_for(user).post(
                reverse("itsm-ticket-transition", args=[t.id]), {"transition_id": str(tr.id)}, format="json"
            )


# ── B1a: a stage must name its approver ─────────────────────────────────────

class StageValidationTests(_Base):
    def post_stage(self, **body):
        body.setdefault("workflow", str(self.awf.id))
        body.setdefault("name", "L1")
        return self.client_for(self.root).post(reverse("itsm-approval-stage-list"), body, format="json")

    def test_types_require_their_target(self):
        for atype, field in (("specific_user", "approver_user"), ("role", "approver_role"),
                             ("group", "approver_group")):
            resp = self.post_stage(approver_type=atype)
            self.assertEqual(resp.status_code, 400, atype)
            self.assertIn(field, resp.data)
        self.assertFalse(ApprovalStage.objects.filter(workflow=self.awf).exists())

    def test_inactive_user_rejected(self):
        self.alice.is_active = False
        self.alice.save()
        resp = self.post_stage(approver_type="specific_user", approver_user=self.alice.id)
        self.assertEqual(resp.status_code, 400)

    def test_manager_without_fallback_ok_and_fks_normalised(self):
        from apps.itsm_rbac.models import SystemRole
        role = SystemRole.objects.get(code="agent")
        resp = self.post_stage(approver_type="requestor_manager", approver_role=str(role.id))
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(resp.data["approver_role"])  # irrelevant FK cleared

    def test_names_auto_level_and_readd_after_delete(self):
        r1 = self.post_stage(approver_type="specific_user", approver_user=self.alice.id)
        r2 = self.post_stage(name="L2", approver_type="specific_user", approver_user=self.bob.id)
        self.assertEqual((r1.data["level"], r2.data["level"]), (1, 2))
        self.assertEqual(r1.data["approver_user_name"], "Alice Approver")  # U7
        # Soft-delete level 2, then re-add the SAME level explicitly (B3 constraint).
        ApprovalStage.objects.get(pk=r2.data["id"]).soft_delete()
        r3 = self.post_stage(name="L2b", level=2, approver_type="specific_user", approver_user=self.bob.id)
        self.assertEqual(r3.status_code, 201, r3.data)
        # A live clash is a clean 400, not a 500.
        r4 = self.post_stage(name="dup", level=2, approver_type="specific_user", approver_user=self.bob.id)
        self.assertEqual(r4.status_code, 400)
        self.assertIn("level", r4.data)

    def test_problem_badge_for_empty_role(self):
        from apps.itsm_rbac.models import SystemRole
        role = SystemRole.objects.get(code="supervisor")
        self.stage(approver_type="role", approver_role=role)
        data = self.client_for(self.root).get(reverse("itsm-approval-workflow-detail", args=[self.awf.id])).data
        self.assertIn("nobody active has the role", data["stages"][0]["approver_problem"])


# ── B1b: an unresolvable approver BLOCKS the status change ─────────────────

class StartBlockedTests(_Base):
    def test_requestor_without_manager_blocks_transition_atomically(self):
        self.stage()
        self.wire_start()
        nomgr = User.objects.create_user(username="nomgr", password="x")
        t = self.ticket(requestor=nomgr)
        resp = self.transition_api(self.root, t, self.approve_tr)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Approval can't start", resp.data["detail"])
        self.assertIn("the requestor has no manager set", resp.data["detail"])
        t.refresh_from_db()
        self.assertEqual(t.status.key, "new")  # kept its status
        self.assertFalse(ApprovalRequest.objects.filter(ticket=t).exists())  # nothing half-made

    def test_empty_role_inactive_user_and_no_stages_block(self):
        from apps.itsm_rbac.models import SystemRole
        t = self.ticket()
        self.stage(approver_type="role", approver_role=SystemRole.objects.get(code="supervisor"))
        with self.assertRaises(approval_engine.ApprovalStartError) as ctx:
            approval_engine.start_approval(t, self.awf, user=self.root)
        self.assertIn("nobody active has the role", ctx.exception.message)

        awf2 = ApprovalWorkflow.objects.create(name="One person")
        self.alice.is_active = False
        self.alice.save()
        self.stage(awf=awf2, approver_type="specific_user", approver_user=self.alice)
        with self.assertRaises(approval_engine.ApprovalStartError) as ctx:
            approval_engine.start_approval(t, awf2)
        self.assertIn("deactivated", ctx.exception.message)

        empty = ApprovalWorkflow.objects.create(name="Empty")
        with self.assertRaises(approval_engine.ApprovalStartError):
            approval_engine.start_approval(t, empty)
        self.assertFalse(ApprovalRequest.objects.filter(ticket=t).exists())

    def test_happy_path_request_exists_immediately_and_emits_requested_with_stage(self):
        s = self.stage()
        self.wire_start()
        t = self.ticket()
        # In-transaction: the request exists before any on_commit callback runs.
        with self.captureOnCommitCallbacks(execute=False):
            engine.transition(t, self.approve_tr, self.root)
            self.assertTrue(ApprovalRequest.objects.filter(ticket=t, status="pending").exists())
        ApprovalRequest.objects.filter(ticket=t).delete()
        t = self.ticket()
        with mock.patch("apps.itsm_core.services.hooks.emit_event") as emit:
            resp = self.transition_api(self.root, t, self.approve_tr)
        self.assertEqual(resp.status_code, 200, resp.data)
        req = ApprovalRequest.objects.get(ticket=t)
        calls = [c for c in emit.call_args_list if c.args[0] == "ApprovalRequested"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].kwargs["context"], {"approval_request": str(req.id), "stage": str(s.id)})

    def test_inactive_or_deleted_policy_starts_nothing(self):
        self.stage()
        self.wire_start()
        self.awf.is_active = False
        self.awf.save()
        t = self.ticket()
        resp = self.transition_api(self.root, t, self.approve_tr)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(ApprovalRequest.objects.filter(ticket=t).exists())
        # The direct API start refuses an inactive workflow.
        resp = self.client_for(self.root).post(reverse("itsm-approval-request-start"),
                                               {"ticket": str(t.id), "workflow": str(self.awf.id)},
                                               format="json")
        self.assertEqual(resp.status_code, 400)

    def test_level_advance_refused_when_next_stage_broke(self):
        self.stage(level=1)
        s2 = self.stage(level=2, name="Finance", approver_type="specific_user", approver_user=self.alice)
        t = self.ticket()
        req = approval_engine.start_approval(t, self.awf)
        self.alice.is_active = False
        self.alice.save()
        state = approval_engine.request_state(req, self.boss)
        self.assertIn("Finance", state["blocked_reason"])
        with self.assertRaises(approval_engine.ApprovalStartError) as ctx:
            approval_engine.decide(req, self.boss, "approved")
        self.assertIn("next stage “Finance”", ctx.exception.message)
        req.refresh_from_db()
        self.assertEqual(req.current_stage_id, ApprovalStage.objects.get(workflow=self.awf, level=1).id)
        self.assertFalse(ApprovalAction.objects.filter(approval_request=req).exists())
        # Rejecting is still allowed.
        approval_engine.decide(req, self.boss, "rejected", "no budget")
        req.refresh_from_db()
        self.assertEqual(req.status, "rejected")
        self.assertIsNotNone(s2)


# ── B2: the Require-approval gate ──────────────────────────────────────────

class GateTests(_Base):
    def setUp(self):
        super().setUp()
        self.stage()
        TransitionCondition.objects.get_or_create(transition=self.start_fulfilment,
                                                  condition_type="approval_granted",
                                                  defaults={"config": {}})
        self.t = self.ticket()
        engine.transition(self.t, self.approve_tr, self.root)
        self.t.refresh_from_db()

    def names(self):
        return {tr.name for tr in engine.available_transitions(self.t, self.root)}

    def test_no_request_passes(self):
        self.assertIn("Start Fulfilment", self.names())

    def test_rejected_blocks_then_new_approval_passes(self):
        req = approval_engine.start_approval(self.t, self.awf)
        approval_engine.decide(req, self.boss, "rejected", "no")
        self.assertNotIn("Start Fulfilment", self.names())
        with self.assertRaises(engine.TransitionError):
            engine.transition(self.t, self.start_fulfilment, self.root)
        req2 = approval_engine.start_approval(self.t, self.awf)
        approval_engine.decide(req2, self.boss, "approved")
        self.assertIn("Start Fulfilment", self.names())

    def test_cancelled_is_ignored(self):
        approval_engine.start_approval(self.t, self.awf)
        approval_engine.cancel_pending(self.t)
        self.assertIn("Start Fulfilment", self.names())


# ── B3: parallel mode ──────────────────────────────────────────────────────

class ParallelTests(_Base):
    def setUp(self):
        super().setUp()
        self.awf.mode = "parallel"
        self.awf.save()
        self.s1 = self.stage(level=1, name="Alice", approver_type="specific_user", approver_user=self.alice)
        self.s2 = self.stage(level=2, name="Bob", approver_type="specific_user", approver_user=self.bob)
        self.t = self.ticket()

    def test_all_pending_out_of_order_and_complete_when_all_met(self):
        with mock.patch("apps.itsm_core.services.hooks.emit_event") as emit, \
                self.captureOnCommitCallbacks(execute=True):
            req = approval_engine.start_approval(self.t, self.awf)
        stages = {c.kwargs["context"]["stage"] for c in emit.call_args_list if c.args[0] == "ApprovalRequested"}
        self.assertEqual(stages, {str(self.s1.id), str(self.s2.id)})
        self.assertEqual(req.mode, "parallel")
        self.assertEqual({s.id for s in approval_engine.pending_stages(req)}, {self.s1.id, self.s2.id})
        self.assertEqual(list(approval_engine.pending_for(self.bob)), [req])
        approval_engine.decide(req, self.bob, "approved")  # level 2 first
        req.refresh_from_db()
        self.assertEqual(req.status, "pending")
        self.assertEqual([s.id for s in approval_engine.pending_stages(req)], [self.s1.id])
        approval_engine.decide(req, self.alice, "approved")
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")

    def test_any_rejection_rejects_whole_request(self):
        req = approval_engine.start_approval(self.t, self.awf)
        approval_engine.decide(req, self.alice, "rejected", "no")
        req.refresh_from_db()
        self.assertEqual(req.status, "rejected")

    def test_snapshot_survives_policy_edits(self):
        req = approval_engine.start_approval(self.t, self.awf)
        self.awf.mode = "sequential"
        self.awf.save()
        self.s2.soft_delete()
        self.stage(level=3, name="Late", approver_type="specific_user", approver_user=self.root)
        req.refresh_from_db()
        self.assertEqual({s.id for s in approval_engine.pending_stages(req)}, {self.s1.id, self.s2.id})


# ── U2 / U3 / A1 / A2 / pending_approver_users ─────────────────────────────

class DecideApiTests(_Base):
    def setUp(self):
        super().setUp()
        self.stage()
        self.t = self.ticket()
        self.req = approval_engine.start_approval(self.t, self.awf)

    def test_can_decide_matrix(self):
        self.assertTrue(approval_engine.request_state(self.req, self.boss)["can_decide"])
        self.assertFalse(approval_engine.request_state(self.req, self.alice)["can_decide"])
        # A superuser only gets the buttons when nobody else can decide.
        self.assertFalse(approval_engine.request_state(self.req, self.root)["can_decide"])
        self.boss.is_active = False
        self.boss.save()
        state = approval_engine.request_state(self.req, self.root)
        self.assertTrue(state["can_decide"])
        self.assertTrue(state["blocked_reason"])

    def test_waiting_for_names_and_api_fields(self):
        data = self.client_for(self.root).get(
            reverse("itsm-approval-request-list"), {"ticket": str(self.t.id)}
        ).data
        row = (data["results"] if isinstance(data, dict) else data)[0]
        self.assertEqual(row["pending_stages"][0]["approver_names"], ["Bea Boss"])
        self.assertEqual(row["ticket_project_key"], self.project.key)
        self.assertFalse(row["can_decide"])

    def test_rule_all_already_acted_cannot_decide_again(self):
        awf = ApprovalWorkflow.objects.create(name="Group all")
        from apps.itsm_groups.models import Group, GroupMembership
        g = Group.objects.create(name="Approvers", key="approvers")
        for u in (self.alice, self.bob):
            GroupMembership.objects.create(group=g, user=u)
        self.stage(awf=awf, approver_type="group", approver_group=g, rule="all")
        t2 = self.ticket()
        req = approval_engine.start_approval(t2, awf)
        approval_engine.decide(req, self.alice, "approved")
        self.assertFalse(approval_engine.request_state(req, self.alice)["can_decide"])
        self.assertTrue(approval_engine.request_state(req, self.bob)["can_decide"])
        with self.assertRaises(engine.TransitionError) as ctx:
            approval_engine.decide(req, self.alice, "approved")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_reject_needs_reason_and_reason_is_kept(self):
        c = self.client_for(self.boss)
        url = reverse("itsm-approval-request-reject", args=[self.req.id])
        self.assertEqual(c.post(url, {"comment": "  "}, format="json").status_code, 400)
        with self.captureOnCommitCallbacks(execute=True):
            resp = c.post(url, {"comment": "Over budget"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["actions"][0]["comment"], "Over budget")
        self.assertEqual(resp.data["actions"][0]["stage_name"], "Manager")
        from apps.itsm_core.models import AuditEvent
        ev = AuditEvent.objects.get(ticket=self.t, action="approval_rejected")
        self.assertEqual(ev.payload["comment"], "Over budget")

    def test_non_approver_403(self):
        resp = self.client_for(self.alice).post(reverse("itsm-approval-request-approve", args=[self.req.id]))
        self.assertEqual(resp.status_code, 403)

    def test_start_requires_permission(self):
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        agent = User.objects.create_user(username="agent1", password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        t2 = self.ticket()
        resp = self.client_for(agent).post(reverse("itsm-approval-request-start"),
                                           {"ticket": str(t2.id), "workflow": str(self.awf.id)}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(ApprovalRequest.objects.filter(ticket=t2).exists())

    def test_list_clamped_for_requestors(self):
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        stranger = User.objects.create_user(username="stranger", password="x")
        RoleAssignment.objects.create(user=stranger, role=SystemRole.objects.get(code="requestor"))
        RoleAssignment.objects.create(user=self.req_user, role=SystemRole.objects.get(code="requestor"))
        RoleAssignment.objects.create(user=self.boss, role=SystemRole.objects.get(code="requestor"))
        url = reverse("itsm-approval-request-list")

        def ids(user):
            d = self.client_for(user).get(url).data
            return {r["id"] for r in (d["results"] if isinstance(d, dict) else d)}

        self.assertEqual(ids(stranger), set())
        self.assertEqual(ids(self.req_user), {str(self.req.id)})  # own ticket
        self.assertEqual(ids(self.boss), {str(self.req.id)})      # approver on it

    def test_pending_approver_users(self):
        self.assertEqual(approval_engine.pending_approver_users(self.t), [self.boss])
        stage = self.req.current_stage
        self.assertEqual(approval_engine.pending_approver_users(self.t, stage=stage.id), [self.boss])
        self.assertEqual(approval_engine.pending_approver_users(self.t, stage="00000000-0000-0000-0000-000000000000"), [])
        approval_engine.decide(self.req, self.boss, "approved")
        self.assertEqual(approval_engine.pending_approver_users(self.t), [])

    def test_fallback_approver_in_inbox(self):
        awf = ApprovalWorkflow.objects.create(name="Fallback")
        self.stage(awf=awf, approver_user=self.alice)
        nomgr = User.objects.create_user(username="nomgr2", password="x")
        t2 = self.ticket(requestor=nomgr)
        req = approval_engine.start_approval(t2, awf)
        self.assertIn(req, list(approval_engine.pending_for(self.alice)))


# ── Rejected → auto-move into the `rejected` status ────────────────────────

class RejectedAutoMoveTests(_Base):
    def setUp(self):
        super().setUp()
        self.stage()
        self.wire_start()
        self.t = self.ticket()
        with self.captureOnCommitCallbacks(execute=True):
            engine.transition(self.t, self.approve_tr, self.root)  # → approved + pending
        self.t.refresh_from_db()
        self.req = ApprovalRequest.objects.get(ticket=self.t, status="pending")

    def test_moves_to_rejected_when_transition_exists(self):
        done = StatusCategory.objects.get(key="done")
        rejected, _ = Status.objects.get_or_create(
            workflow=self.wf, key="rejected", defaults={"name": "Rejected", "category": done})
        Transition.objects.create(workflow=self.wf, name="Reject (test)",
                                  from_status=self.t.status, to_status=rejected)
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(self.req, self.boss, "rejected", "Not needed")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status.key, "rejected")

    def test_stays_put_without_a_rejected_transition(self):
        Transition.objects.filter(workflow=self.wf, to_status__key="rejected").delete()
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(self.req, self.boss, "rejected", "Not needed")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status.key, "approved")
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, "rejected")


# ── Send for approval + On-fly approvers (2026-10-24) ──────────────────────

class _SendBase(_Base):
    """A ticket sitting in In Progress (flagged for Send for approval, waiting in a new
    "Awaiting Approval" status) and an On-fly policy picking from Alice/Bob."""

    def setUp(self):
        super().setUp()
        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        from apps.itsm_tickets.models import Ticket

        self.in_progress = Status.objects.get(workflow=self.wf, key="in_progress")
        self.waiting = Status.objects.create(
            workflow=self.wf, key="awaiting_approval", name="Awaiting Approval",
            category=StatusCategory.objects.get(key="in_progress"), pauses_sla=True)
        self.in_progress.allows_send_for_approval = True
        self.in_progress.approval_waiting_status = self.waiting
        self.in_progress.save()

        self.agent = User.objects.create_user(username="agent1", password="x", full_name="Agnes Agent")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk=self.project.helpdesk, user=self.agent,
                                          is_active=True, role_in_helpdesk="lead")
        self.agent2 = User.objects.create_user(username="agent2", password="x")
        RoleAssignment.objects.create(user=self.agent2, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk=self.project.helpdesk, user=self.agent2,
                                          is_active=True, role_in_helpdesk="lead")

        self.fly = ApprovalWorkflow.objects.create(name="On Demand", project=self.project)
        self.fly_stage = ApprovalStage.objects.create(
            workflow=self.fly, level=1, name="Pick", approver_type="on_the_fly", on_fly_pool="listed_users")
        self.fly_stage.candidate_users.set([self.alice, self.bob])

        self.t = self.ticket()
        Ticket.objects.filter(pk=self.t.pk).update(status=self.in_progress)
        self.t.refresh_from_db()

    def send_api(self, user, workflow=None, approvers=None, note="", ticket=None):
        body = {"ticket": str((ticket or self.t).id), "workflow": str((workflow or self.fly).id),
                "approvers": approvers if approvers is not None else {str(self.fly_stage.id): [self.alice.id]},
                "note": note}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client_for(user).post(reverse("itsm-approval-request-send"), body, format="json")


class OnFlyStageConfigTests(_SendBase):
    def post_stage(self, **body):
        body.setdefault("workflow", str(self.fly.id))
        body.setdefault("name", "Stage")
        body.setdefault("approver_type", "on_the_fly")
        return self.client_for(self.root).post(reverse("itsm-approval-stage-list"), body, format="json")

    def test_pool_is_required_and_validated(self):
        self.assertIn("on_fly_pool", self.post_stage().data)
        self.assertIn("approver_group", self.post_stage(on_fly_pool="group").data)
        self.assertIn("candidate_users", self.post_stage(on_fly_pool="listed_users").data)
        self.alice.is_active = False
        self.alice.save()
        resp = self.post_stage(on_fly_pool="listed_users", candidate_users=[self.alice.id])
        self.assertIn("candidate_users", resp.data)
        resp = self.post_stage(on_fly_pool="listed_users", candidate_users=[self.bob.id], min_approvals=2)
        self.assertIn("min_approvals", resp.data)

    def test_any_user_pool_saves_and_normalises(self):
        from apps.itsm_groups.models import Group
        g = Group.objects.create(name="Approvers", key="approvers")
        resp = self.post_stage(on_fly_pool="any_user", approver_group=str(g.id),
                               candidate_users=[self.bob.id], approver_user=self.boss.id)
        self.assertEqual(resp.status_code, 201, resp.data)
        st = ApprovalStage.objects.get(pk=resp.data["id"])
        self.assertIsNone(st.approver_group_id)
        self.assertIsNone(st.approver_user_id)
        self.assertFalse(st.candidate_users.exists())
        self.assertIsNone(resp.data["approver_problem"])
        # A non-On-fly stage never keeps a pool.
        resp = self.post_stage(approver_type="specific_user", approver_user=self.bob.id,
                               on_fly_pool="any_user", candidate_users=[self.alice.id])
        st = ApprovalStage.objects.get(pk=resp.data["id"])
        self.assertEqual((st.on_fly_pool, st.candidate_users.count()), ("", 0))

    def test_refused_when_policy_is_wired_to_a_transition(self):
        self.wire_start(awf=self.awf)
        resp = self.post_stage(workflow=str(self.awf.id), on_fly_pool="any_user")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Approve", resp.data["approver_type"][0])

    def test_transition_cannot_name_an_on_fly_policy(self):
        url = reverse("itsm-transition-detail", args=[self.approve_tr.id])
        resp = self.client_for(self.root).patch(url, {"post_functions": [
            {"type": "request_approval", "config": {"workflow_id": str(self.fly.id)}}]}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("On-fly", str(resp.data["post_functions"]))

    def test_transition_start_of_on_fly_policy_rolls_back(self):
        # Wired before the guard existed (or by a data script): the start still refuses.
        self.wire_start(awf=self.fly)
        t = self.ticket()
        resp = self.transition_api(self.root, t, self.approve_tr)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Send for approval", resp.data["detail"])
        t.refresh_from_db()
        self.assertEqual(t.status.key, "new")
        self.assertFalse(ApprovalRequest.objects.filter(ticket=t).exists())


class SendForApprovalTests(_SendBase):
    def test_send_creates_request_picks_and_moves_to_waiting(self):
        with mock.patch("apps.itsm_core.services.hooks.emit_event") as emit, \
                mock.patch("apps.itsm_core.services.hooks.sla_on_status_change") as sla:
            resp = self.send_api(self.agent, note="Water damage — replace")
        self.assertEqual(resp.status_code, 201, resp.data)
        req = ApprovalRequest.objects.get(ticket=self.t)
        self.assertEqual((req.source, req.note), ("sent", "Water damage — replace"))
        self.assertEqual((req.return_status_id, req.waiting_status_id), (self.in_progress.id, self.waiting.id))
        self.assertEqual(req.requested_by, self.agent)
        self.assertEqual(resp.data["waiting_status_name"], "Awaiting Approval")
        self.assertTrue(resp.data["can_withdraw"])
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.waiting)
        # Picked approver is the only one who can decide; notifications go to them.
        self.assertEqual(approval_engine.pending_approver_users(self.t), [self.alice])
        self.assertTrue(approval_engine.request_state(req, self.alice)["can_decide"])
        self.assertFalse(approval_engine.request_state(req, self.bob)["can_decide"])
        events = [c.args[0] for c in emit.call_args_list]
        self.assertIn("ApprovalRequested", events)
        self.assertIn("StatusChanged", events)
        sla.assert_called_once()  # the waiting status's pauses_sla is honoured centrally
        from apps.itsm_core.models import AuditEvent
        ev = AuditEvent.objects.get(ticket=self.t, action="approval_requested")
        self.assertEqual(ev.payload["approvers"], ["Alice Approver"])
        self.assertTrue(ev.payload["sent"])
        self.assertTrue(AuditEvent.objects.filter(ticket=self.t, action="status_changed",
                                                  payload__to="Awaiting Approval").exists())
        # Frozen while pending.
        self.assertEqual(engine.available_transitions(self.t, self.root), [])
        # Inbox + portal approver access for the picked person.
        self.assertIn(req, list(approval_engine.pending_for(self.alice)))
        self.assertNotIn(req, list(approval_engine.pending_for(self.bob)))

    def test_status_flag_off_pending_and_wrong_project(self):
        self.in_progress.allows_send_for_approval = False
        self.in_progress.save()
        resp = self.send_api(self.agent)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("doesn't allow Send for approval", resp.data["detail"])
        self.in_progress.allows_send_for_approval = True
        self.in_progress.save()
        other = ApprovalWorkflow.objects.create(name="Elsewhere")
        ApprovalStage.objects.create(workflow=other, level=1, name="X", approver_type="specific_user",
                                     approver_user=self.bob)
        self.assertEqual(self.send_api(self.agent, workflow=other, approvers={}).status_code, 400)
        self.assertEqual(self.send_api(self.agent).status_code, 201)
        resp = self.send_api(self.agent)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(ApprovalRequest.objects.filter(ticket=self.t).count(), 1)

    def test_picks_are_validated(self):
        sid = str(self.fly_stage.id)
        for approvers, needle in (
            ({}, "needs at least one approver picked"),
            ({sid: []}, "needs at least one approver picked"),
            ({sid: [self.boss.id]}, "isn't on its list"),
            ({sid: [999999]}, "doesn't exist"),
            ({sid: ["abc"]}, "map of stage"),
        ):
            resp = self.send_api(self.agent, approvers=approvers)
            self.assertEqual(resp.status_code, 400, approvers)
            self.assertIn(needle, resp.data["detail"])
        self.bob.is_active = False
        self.bob.save()
        resp = self.send_api(self.agent, approvers={sid: [self.bob.id]})
        self.assertIn("can't approve", resp.data["detail"])
        self.fly_stage.min_approvals = 2
        self.fly_stage.save()
        self.bob.is_active = True
        self.bob.save()
        resp = self.send_api(self.agent, approvers={sid: [self.alice.id]})
        self.assertIn("at least 2", resp.data["detail"])
        # Nothing written by any refusal; the ticket kept its status.
        self.assertFalse(ApprovalRequest.objects.filter(ticket=self.t).exists())
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)

    def test_permissions_and_access(self):
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        requestor = User.objects.create_user(username="r2", password="x")
        RoleAssignment.objects.create(user=requestor, role=SystemRole.objects.get(code="requestor"))
        self.assertEqual(self.send_api(requestor).status_code, 403)
        outsider = User.objects.create_user(username="outsider", password="x")
        RoleAssignment.objects.create(user=outsider, role=SystemRole.objects.get(code="agent"))
        self.assertEqual(self.send_api(outsider).status_code, 404)  # no helpdesk access
        resp = self.client_for(outsider).get(reverse("itsm-approval-request-send-options"),
                                             {"ticket": str(self.t.id)})
        self.assertEqual(resp.status_code, 404)

    def test_send_options(self):
        self.stage()  # Manager sign-off: requestor_manager → Bea Boss
        resp = self.client_for(self.agent).get(reverse("itsm-approval-request-send-options"),
                                               {"ticket": str(self.t.id)})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data["allowed"])
        self.assertEqual(resp.data["waiting_status"]["name"], "Awaiting Approval")
        by_name = {w["name"]: w for w in resp.data["workflows"]}
        self.assertEqual(by_name["Manager sign-off"]["stages"][0]["approver_names"], ["Bea Boss"])
        fly = by_name["On Demand"]["stages"][0]
        self.assertEqual({c["name"] for c in fly["candidates"]}, {"Alice Approver", "Bob Approver"})
        self.assertIsNone(by_name["On Demand"]["problem"])

    def test_stay_in_status_when_no_waiting_status(self):
        self.in_progress.approval_waiting_status = None
        self.in_progress.save()
        self.assertEqual(self.send_api(self.agent).status_code, 201)
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)
        req = ApprovalRequest.objects.get(ticket=self.t)
        self.assertIsNone(req.waiting_status_id)
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "approved")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)


class SentDecisionTests(_SendBase):
    def sent(self, **kw):
        self.assertEqual(self.send_api(self.agent, **kw).status_code, 201)
        return ApprovalRequest.objects.get(ticket=self.t, status="pending")

    def test_approve_returns_to_previous_status(self):
        req = self.sent()
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "approved")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)
        self.assertNotEqual(engine.available_transitions(self.t, self.root), [])

    def test_reject_returns_instead_of_moving_to_rejected(self):
        req = self.sent()
        rejected = Status.objects.get(workflow=self.wf, key="rejected")
        Transition.objects.create(workflow=self.wf, name="Reject any", is_global=True, to_status=rejected)
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "rejected", "Repair it instead")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)

    def test_on_fly_second_stage_sequential_and_parallel(self):
        boss_stage = ApprovalStage.objects.create(workflow=self.fly, level=0, name="Manager",
                                                  approver_type="requestor_manager")
        req = self.sent()
        self.assertEqual(req.current_stage, boss_stage)
        self.assertFalse(approval_engine.request_state(req, self.alice)["can_decide"])
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.boss, "approved")
        req.refresh_from_db()
        self.assertEqual(req.current_stage, self.fly_stage)
        self.assertEqual(approval_engine.pending_approver_users(self.t), [self.alice])
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "approved")
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")

        self.fly.mode = "parallel"
        self.fly.save()
        req2 = self.sent()
        self.assertEqual({u.username for u in approval_engine.pending_approver_users(self.t)}, {"boss", "alice"})
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req2, self.alice, "approved")
            approval_engine.decide(req2, self.boss, "approved")
        req2.refresh_from_db()
        self.assertEqual(req2.status, "approved")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)

    def test_no_return_when_ticket_left_the_waiting_status(self):
        from apps.itsm_tickets.models import Ticket
        req = self.sent()
        new = Status.objects.get(workflow=self.wf, key="new")
        Ticket.objects.filter(pk=self.t.pk).update(status=new)  # e.g. a data fix / move
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "approved")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, new)

    def test_deactivated_pick_blocks_and_superuser_can_still_decide(self):
        req = self.sent()
        self.alice.is_active = False
        self.alice.save()
        state = approval_engine.request_state(req, self.root)
        self.assertIn("deactivated", state["blocked_reason"])
        self.assertTrue(state["can_decide"])


class WithdrawTests(_SendBase):
    def withdraw_api(self, user, req, reason=""):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client_for(user).post(reverse("itsm-approval-request-withdraw", args=[req.id]),
                                              {"reason": reason}, format="json")

    def test_sender_withdraws_and_ticket_returns(self):
        self.send_api(self.agent)
        req = ApprovalRequest.objects.get(ticket=self.t)
        with mock.patch("apps.itsm_core.services.hooks.emit_event") as emit:
            resp = self.withdraw_api(self.agent, req, "wrong person")
        self.assertEqual(resp.status_code, 200, resp.data)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)
        self.assertIn("ApprovalCancelled", [c.args[0] for c in emit.call_args_list])
        from apps.itsm_core.models import AuditEvent
        ev = AuditEvent.objects.get(ticket=self.t, action="approval_cancelled")
        self.assertEqual((ev.payload["withdrawn"], ev.payload["reason"]), (True, "wrong person"))
        # Can send again.
        self.assertEqual(self.send_api(self.agent).status_code, 201)

    def test_other_agent_403_supervisor_ok(self):
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        self.send_api(self.agent)
        req = ApprovalRequest.objects.get(ticket=self.t)
        self.assertEqual(self.withdraw_api(self.agent2, req).status_code, 403)
        sup = User.objects.create_user(username="sup", password="x")
        RoleAssignment.objects.create(user=sup, role=SystemRole.objects.get(code="supervisor"))
        from apps.itsm_helpdesks.models import HelpdeskMembership
        HelpdeskMembership.objects.create(helpdesk=self.project.helpdesk, user=sup, is_active=True)
        self.assertEqual(self.withdraw_api(sup, req).status_code, 200)

    def test_policy_request_cannot_be_withdrawn(self):
        self.stage()
        req = approval_engine.start_approval(self.t, self.awf, user=self.root)
        resp = self.withdraw_api(self.root, req)
        self.assertEqual(resp.status_code, 400)
        req.refresh_from_db()
        self.assertEqual(req.status, "pending")


# ── "Pause SLA while waiting" on an approval policy (2026-11-05c) ──────────

def _sla_policy(project):
    """First Response + Resolution targets for p2/p3 on the project. No business
    calendar exists in tests, so the clocks run 24×7 UTC."""
    from apps.itsm_sla.models import SLAMetric, SLAPolicy, SLATarget
    policy = SLAPolicy.objects.create(name="Req SLA", project=project, is_active=True)
    for kind, name, mins in (("first_response", "Time to First Response", 240),
                             ("resolution", "Time to Resolution", 2880)):
        metric = SLAMetric.objects.create(policy=policy, kind=kind, name=name)
        for pr in ("p2", "p3"):
            SLATarget.objects.create(metric=metric, priority=pr, target_minutes=mins)
    return policy


class _SlaClockAsserts:
    def clock(self, t, kind):
        from apps.itsm_sla.models import SLATracker
        return SLATracker.objects.get(ticket=t, metric__kind=kind)

    def intervals(self, t, kind):
        from apps.itsm_sla.models import SLAPauseInterval
        return list(SLAPauseInterval.objects.filter(tracker__ticket=t, tracker__metric__kind=kind)
                    .order_by("paused_at").values_list("reason", "resumed_at"))

    def assertHeld(self, t, reason="approval", kinds=("first_response", "resolution")):
        for kind in kinds:
            self.assertEqual(self.clock(t, kind).state, "paused", kind)
            open_ = [r for r, resumed in self.intervals(t, kind) if resumed is None]
            self.assertEqual(open_, [reason], kind)

    def assertRunning(self, t, kinds=("first_response", "resolution")):
        for kind in kinds:
            self.assertEqual(self.clock(t, kind).state, "running", kind)


class ApprovalSlaPauseTests(_SlaClockAsserts, _Base):
    def setUp(self):
        super().setUp()
        _sla_policy(self.project)
        self.awf.pause_sla = True
        self.awf.save(update_fields=["pause_sla"])
        self.stage()  # requestor's manager (Bea Boss)

    def started(self):
        self.wire_start()
        t = self.ticket()
        self.assertRunning(t)
        resp = self.transition_api(self.root, t, self.approve_tr)
        self.assertEqual(resp.status_code, 200, resp.data)
        return t, ApprovalRequest.objects.get(ticket=t, status="pending")

    def decide(self, req, decision="approved", user=None, comment=""):
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, user or self.boss, decision, comment)

    def test_transition_approval_pauses_the_clocks(self):
        t, req = self.started()
        self.assertTrue(req.pause_sla)
        self.assertHeld(t)
        for kind in ("first_response", "resolution"):
            self.assertEqual(len(self.intervals(t, kind)), 1)

    def test_approve_resumes_and_moves_the_due_date(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.itsm_sla.models import SLAPauseInterval, SLATracker
        t, req = self.started()
        before = self.clock(t, "resolution").due_at
        hour_ago = timezone.now() - timedelta(minutes=60)
        SLATracker.objects.filter(ticket=t).update(paused_at=hour_ago)
        SLAPauseInterval.objects.filter(tracker__ticket=t).update(paused_at=hour_ago)
        self.decide(req)
        self.assertRunning(t)
        res = self.clock(t, "resolution")
        self.assertGreaterEqual(res.total_paused_minutes, 59)
        self.assertGreater(res.due_at, before)
        t.refresh_from_db()
        self.assertEqual(t.due_date, res.due_at)  # the queue's due date follows

    def test_without_the_flag_nothing_pauses(self):
        self.awf.pause_sla = False
        self.awf.save(update_fields=["pause_sla"])
        t, req = self.started()
        self.assertFalse(req.pause_sla)
        self.assertRunning(t)

    def test_next_sequential_level_keeps_the_clocks_paused(self):
        self.stage(level=2, name="IT", approver_type="specific_user", approver_user=self.alice)
        t, req = self.started()
        self.decide(req)  # level 1 approved → level 2 pending
        req.refresh_from_db()
        self.assertEqual(req.status, "pending")
        self.assertHeld(t)
        self.decide(req, user=self.alice)
        self.assertRunning(t)

    def test_reject_into_rejected_status_stops_the_clocks(self):
        rejected = Status.objects.get(workflow=self.wf, key="rejected")
        Transition.objects.create(workflow=self.wf, name="Reject any", is_global=True, to_status=rejected)
        t, req = self.started()
        self.decide(req, "rejected", comment="No budget")
        t.refresh_from_db()
        self.assertEqual(t.status.key, "rejected")
        for kind in ("first_response", "resolution"):
            self.assertIn(self.clock(t, kind).state, ("met", "breached"))

    def test_reject_without_a_rejected_transition_resumes(self):
        t, req = self.started()
        self.decide(req, "rejected", comment="No budget")
        t.refresh_from_db()
        self.assertEqual(t.status.key, "approved")  # no transition from here to Rejected
        self.assertRunning(t)

    def test_create_transition_approval_starts_paused(self):
        create_tr = Transition.objects.filter(workflow=self.wf, from_status__isnull=True,
                                              is_global=False).first()
        if create_tr is None:
            self.skipTest("this workflow has no create transition")
        self.wire_start(tr=create_tr)
        t = self.ticket()
        self.assertTrue(ApprovalRequest.objects.filter(ticket=t, status="pending").exists())
        self.assertHeld(t)

    def test_admin_start_api_pauses(self):
        t = self.ticket()
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client_for(self.root).post(
                reverse("itsm-approval-request-start"),
                {"ticket": str(t.id), "workflow": str(self.awf.id)}, format="json")
        self.assertIn(resp.status_code, (200, 201), resp.data)
        self.assertHeld(t)

    def test_policy_flip_after_start_does_not_change_the_request(self):
        t, req = self.started()
        self.awf.pause_sla = False
        self.awf.save(update_fields=["pause_sla"])
        self.assertHeld(t)
        self.decide(req)
        self.assertRunning(t)

    def test_sync_is_idempotent(self):
        from apps.itsm_sla.services import sla_engine
        t, _ = self.started()
        sla_engine.sync_pauses(t)
        sla_engine.sync_pauses(t)
        for kind in ("first_response", "resolution"):
            self.assertEqual(len(self.intervals(t, kind)), 1)

    def test_resume_sla_post_function_cannot_release_the_hold(self):
        tr = self.wire_start()
        tr.post_functions.append({"type": "resume_sla", "config": {"metric": "resolution"}})
        tr.save(update_fields=["post_functions"])
        t = self.ticket()
        self.transition_api(self.root, t, tr)
        self.assertHeld(t)

    def test_pause_sla_post_function_outlives_the_approval(self):
        tr = self.wire_start()
        tr.post_functions.append({"type": "pause_sla", "config": {"metric": "resolution"}})
        tr.save(update_fields=["post_functions"])
        t = self.ticket()
        self.transition_api(self.root, t, tr)
        self.assertHeld(t, kinds=("first_response",))
        self.assertHeld(t, reason="", kinds=("resolution",))  # the post-function owns it
        self.decide(ApprovalRequest.objects.get(ticket=t, status="pending"))
        self.assertRunning(t, kinds=("first_response",))
        self.assertEqual(self.clock(t, "resolution").state, "paused")

    def test_first_public_reply_while_held_meets_the_response_clock(self):
        t, _ = self.started()
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.add_comment(ticket=t, author=self.root, body_html="<p>On it</p>")
        self.assertEqual(self.clock(t, "first_response").state, "met")
        self.assertHeld(t, kinds=("resolution",))

    def test_priority_change_keeps_the_hold(self):
        t, _ = self.started()
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.update_ticket(ticket=t, user=self.root, priority="p2")
        self.assertHeld(t)

    def test_cancel_pending_resumes(self):
        t, _ = self.started()
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.cancel_pending(t, user=self.root)
        self.assertRunning(t)

    def test_sla_endpoint_reports_the_reason(self):
        t, req = self.started()
        rows = self.client_for(self.root).get(reverse("itsm-ticket-sla", args=[t.id])).json()
        self.assertEqual({r["pause_reason"] for r in rows}, {"approval"})
        self.decide(req)
        rows = self.client_for(self.root).get(reverse("itsm-ticket-sla", args=[t.id])).json()
        self.assertEqual({r["pause_reason"] for r in rows}, {None})


class SentApprovalSlaPauseTests(_SlaClockAsserts, _SendBase):
    def setUp(self):
        _sla_policy(Project.objects.get(helpdesk__key="IT", project_type="service_request"))
        super().setUp()  # creates self.t → its clocks start
        self.waiting.pauses_sla = False  # only the approval pauses, unless a test says so
        self.waiting.save(update_fields=["pauses_sla"])
        self.fly.pause_sla = True
        self.fly.save(update_fields=["pause_sla"])

    def sent(self):
        self.assertEqual(self.send_api(self.agent).status_code, 201)
        return ApprovalRequest.objects.get(ticket=self.t, status="pending")

    def test_send_pauses_and_approve_resumes(self):
        req = self.sent()
        self.assertHeld(self.t)
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "approved")
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, self.in_progress)
        self.assertRunning(self.t)

    def test_withdraw_resumes(self):
        from apps.itsm_approvals.services import send
        req = self.sent()
        with self.captureOnCommitCallbacks(execute=True):
            send.withdraw(req, self.agent)
        self.assertRunning(self.t)

    def test_waiting_status_that_pauses_plus_the_flag_is_one_window(self):
        self.waiting.pauses_sla = True
        self.waiting.save(update_fields=["pauses_sla"])
        req = self.sent()
        self.assertHeld(self.t, reason="")
        for kind in ("first_response", "resolution"):
            self.assertEqual(len(self.intervals(self.t, kind)), 1)
        with self.captureOnCommitCallbacks(execute=True):
            approval_engine.decide(req, self.alice, "approved")
        self.assertRunning(self.t)
