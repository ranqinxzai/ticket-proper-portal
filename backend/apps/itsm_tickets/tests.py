"""Integration tests: ticket numbering, RBAC, workflow transitions."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.itsm_projects.models import Project
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import check_permission
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.seed import run as seed_workflows
from apps.itsm_workflows.services import engine

from .services import numbering, ticket_service

User = get_user_model()


def _seed_min():
    seed_rbac()
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    seed_helpdesks()
    seed_workflows()
    from apps.itsm_groups.seed import run as seed_groups
    seed_groups()
    from apps.itsm_projects.seed import run as seed_projects
    seed_projects()


def _project(helpdesk_key, project_type):
    """Fetch a seeded per-helpdesk project by (helpdesk, type) — keys are now
    prefixed (IT → ITINC/ITREQ), so look up by the stable attributes."""
    return Project.objects.get(helpdesk__key=helpdesk_key, project_type=project_type)


class NumberingTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")

    def test_sequential_unique_numbers(self):
        nums = [numbering.generate_ticket_number(self.inc) for _ in range(5)]
        self.assertEqual(nums, ["ITINC-1", "ITINC-2", "ITINC-3", "ITINC-4", "ITINC-5"])
        self.assertEqual(len(set(nums)), 5)

    def test_per_project_sequences_independent(self):
        req = _project("IT", "service_request")
        self.assertEqual(numbering.generate_ticket_number(self.inc), "ITINC-1")
        self.assertEqual(numbering.generate_ticket_number(req), "ITREQ-1")


class RBACTests(TestCase):
    def setUp(self):
        _seed_min()
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.sup = User.objects.create_user(username="su", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))

    def test_agent_can_create_tickets_not_delete_projects(self):
        self.assertTrue(check_permission(self.agent, "itsm.tickets", "create"))
        self.assertFalse(check_permission(self.agent, "itsm.projects", "delete"))
        self.assertFalse(check_permission(self.agent, "itsm.admin.roles", "read"))

    def test_supervisor_full_access(self):
        self.assertTrue(check_permission(self.sup, "itsm.projects", "delete"))
        self.assertTrue(check_permission(self.sup, "itsm.admin.roles", "update"))

    def test_unassigned_user_denied(self):
        nobody = User.objects.create_user(username="nb", password="x")
        self.assertFalse(check_permission(nobody, "itsm.tickets", "read"))


class WorkflowTransitionTests(TestCase):
    def setUp(self):
        _seed_min()
        self.user = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.user, role=SystemRole.objects.get(code="agent"))
        inc = _project("IT", "incident")
        self.ticket = ticket_service.create_ticket(
            project=inc, ticket_type=inc.ticket_types.get(key="incident"),
            summary="Test", priority="high", user=self.user,
        )

    def test_create_starts_in_initial_status(self):
        self.assertEqual(self.ticket.status.key, "new")

    def test_transition_moves_status_and_stamps(self):
        assign = Transition.objects.get(workflow=self.ticket.workflow, name="Assign")
        engine.transition(self.ticket, assign, self.user)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.key, "assigned")
        self.assertIsNotNone(self.ticket.assigned_at)

    def test_stale_transition_conflicts(self):
        # advance, then try a transition that's no longer valid from current status
        assign = Transition.objects.get(workflow=self.ticket.workflow, name="Assign")
        engine.transition(self.ticket, assign, self.user)
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(self.ticket, assign, self.user)  # from_status no longer matches
        self.assertEqual(ctx.exception.status_code, 409)

    def test_resolve_stamps_resolved_at(self):
        for name in ("Assign", "Start Progress", "Resolve"):
            tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
            engine.transition(self.ticket, tr, self.user, fields={"resolution": "fixed"})
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.category.key, "done")
        self.assertIsNotNone(self.ticket.resolved_at)
