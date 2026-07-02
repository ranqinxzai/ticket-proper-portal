"""Per-transition approval wiring: the `requires_approval` serializer toggle (which
syncs the `approval_granted` gate condition) and the engine gate behaviour."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_approvals.models import ApprovalWorkflow
from apps.itsm_approvals.services import engine as approval_engine
from apps.itsm_projects.models import Project
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.services import engine

User = get_user_model()


def _seed_all():
    from apps.itsm_approvals.seed import run as seed_approvals
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
    seed_approvals()  # gates Request "→ approved" transitions + sample approval policy


def _request_project():
    return Project.objects.get(helpdesk__key="IT", project_type="service_request")


class RequiresApprovalToggleTests(TestCase):
    """PATCH /transitions/{id}/ with `requires_approval` syncs the gate condition."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        # "Start Fulfilment" (approved → in_progress) has real post_functions we must not lose.
        self.tr = Transition.objects.get(
            workflow=_request_project().default_workflow, name="Start Fulfilment"
        )
        self.url = reverse("itsm-transition-detail", args=[self.tr.id])

    def _gate_qs(self):
        return self.tr.conditions.filter(condition_type="approval_granted")

    def test_enable_creates_gate_condition(self):
        self.assertFalse(self._gate_qs().exists())
        resp = self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._gate_qs().count(), 1)

    def test_enable_is_idempotent(self):
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.assertEqual(self._gate_qs().count(), 1)

    def test_disable_removes_gate_condition(self):
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.client.patch(self.url, {"requires_approval": False}, format="json")
        self.assertFalse(self._gate_qs().exists())

    def test_omitting_flag_leaves_conditions_untouched(self):
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        # An unrelated edit (note prompt) must not wipe the gate.
        self.client.patch(self.url, {"note_prompt": True, "note_heading": "Why"}, format="json")
        self.assertEqual(self._gate_qs().count(), 1)

    def test_post_functions_passthrough_preserved(self):
        # The client merges the request_approval entry; the serializer just stores the array.
        awf = ApprovalWorkflow.objects.get(name="Standard Procurement Approval")
        merged = [pf for pf in self.tr.post_functions if pf["type"] != "request_approval"]
        merged.append({"type": "request_approval", "config": {"workflow_id": str(awf.id)}})
        resp = self.client.patch(self.url, {"post_functions": merged}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.tr.refresh_from_db()
        types = {pf["type"] for pf in self.tr.post_functions}
        self.assertIn("auto_assign", types)        # original survives
        self.assertIn("request_approval", types)   # new one added


class ApprovalGateEngineTests(TestCase):
    """The `approval_granted` condition hides a gated transition until sign-off."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        proj = _request_project()
        self.ticket = ticket_service.create_ticket(
            project=proj, ticket_type=proj.ticket_types.first(),
            summary="Need a laptop", priority="medium", user=self.root,
            apply_routing=False,
        )
        # Seeded gate: "Approve" (new → approved) carries the approval_granted condition.
        self.approve = Transition.objects.get(workflow=proj.default_workflow, name="Approve")
        self.awf = ApprovalWorkflow.objects.get(name="Standard Procurement Approval")

    def _approve_names(self):
        return {t.name for t in engine.available_transitions(self.ticket, self.root)}

    def test_gate_present_on_seeded_approve(self):
        self.assertTrue(
            self.approve.conditions.filter(condition_type="approval_granted").exists()
        )

    def test_approve_blocked_while_pending_then_allowed_after_grant(self):
        # No approval started yet → gate passes (backward compatible).
        self.assertIn("Approve", self._approve_names())

        # Start the approval → now pending → Approve is hidden.
        req = approval_engine.start_approval(self.ticket, self.awf, user=self.root)
        self.assertNotIn("Approve", self._approve_names())

        # Drive both sequential stages (superuser may decide any stage).
        approval_engine.decide(req, self.root, "approved")  # L1 → advances
        approval_engine.decide(req, self.root, "approved")  # L2 → granted
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")
        self.assertIn("Approve", self._approve_names())


class StatusPausesSlaSerializerTests(TestCase):
    """`pauses_sla` ("Exclude from SLA") round-trips through the Status serializer."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.workflow = Project.objects.get(
            helpdesk__key="IT", project_type="incident"
        ).default_workflow
        from apps.itsm_workflows.models import StatusCategory
        self.category = StatusCategory.objects.get(key="in_progress")

    def test_create_defaults_false_and_accepts_true(self):
        url = reverse("itsm-status-list")
        resp = self.client.post(url, {
            "workflow": str(self.workflow.id), "name": "Working", "key": "working_x",
            "category": str(self.category.id),
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertFalse(resp.json()["pauses_sla"])  # default when omitted

        resp = self.client.post(url, {
            "workflow": str(self.workflow.id), "name": "Hold", "key": "hold_x",
            "category": str(self.category.id), "pauses_sla": True,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.json()["pauses_sla"])

    def test_patch_toggles_pauses_sla(self):
        from apps.itsm_workflows.models import Status
        st = Status.objects.create(workflow=self.workflow, name="Hold2", key="hold2_x",
                                   category=self.category)
        url = reverse("itsm-status-detail", args=[st.id])
        resp = self.client.patch(url, {"pauses_sla": True}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        st.refresh_from_db()
        self.assertTrue(st.pauses_sla)
