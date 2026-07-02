"""Per-user project assignment — strict-whitelist access + hard boundary.

Covers `services.accessible_project_ids` (the scope rule + lead overrides),
`ProjectViewSet` list/tab scoping, the ticket hard boundary, and the
`add_member` requestor guard + `create_user` project validation.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_helpdesks.models import HelpdeskMembership
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_tickets.services import ticket_service

from .models import Project, ProjectMembership
from .seed import run as seed_projects
from .services import accessible_project_ids

User = get_user_model()


def _seed():
    seed_rbac()
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


class ProjectAccessTests(TestCase):
    def setUp(self):
        cache.clear()  # check_permission is cached per (role, module, action)
        _seed()
        self.itinc = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.itreq = Project.objects.get(helpdesk__key="IT", project_type="service_request")
        self.hd_it = self.itinc.helpdesk_id

        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.hd_it, user=self.agent, is_active=True)

        self.sup = User.objects.create_user(username="su", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.boss = User.objects.create_superuser(username="boss", password="x", email="b@b.io")

    # ── the scope rule ───────────────────────────────────────────────────────
    def test_superuser_and_supervisor_unrestricted(self):
        self.assertIsNone(accessible_project_ids(self.boss))
        self.assertIsNone(accessible_project_ids(self.sup))  # itsm.projects:update

    def test_member_with_no_grant_sees_nothing(self):
        # Strict whitelist: a member helpdesk with zero ProjectMembership ⇒ no projects.
        self.assertEqual(accessible_project_ids(self.agent), [])

    def test_member_sees_only_assigned_project(self):
        ProjectMembership.objects.create(project=self.itinc, user=self.agent)
        self.assertEqual(accessible_project_ids(self.agent), [self.itinc.id])

    def test_helpdesk_lead_sees_all_helpdesk_projects(self):
        HelpdeskMembership.objects.filter(helpdesk_id=self.hd_it, user=self.agent).update(
            role_in_helpdesk="lead"
        )
        self.assertEqual(
            set(accessible_project_ids(self.agent)), {self.itinc.id, self.itreq.id}
        )

    def test_project_lead_override(self):
        # A member of IT with no grant, but lead of ITREQ → still sees ITREQ.
        self.itreq.lead = self.agent
        self.itreq.save(update_fields=["lead"])
        self.assertEqual(accessible_project_ids(self.agent), [self.itreq.id])

    # ── tab/list scoping + ticket hard boundary ──────────────────────────────
    def test_project_list_scoped_to_assignment(self):
        ProjectMembership.objects.create(project=self.itinc, user=self.agent)
        client = APIClient()
        client.force_authenticate(self.agent)
        keys = {p["key"] for p in client.get(reverse("itsm-project-list")).json()["results"]}
        self.assertIn(self.itinc.key, keys)
        self.assertNotIn(self.itreq.key, keys)

    def test_ticket_hard_boundary(self):
        ProjectMembership.objects.create(project=self.itinc, user=self.agent)
        mine = ticket_service.create_ticket(
            project=self.itinc, ticket_type=self.itinc.ticket_types.first(),
            summary="mine", priority="medium", apply_routing=False,
        )
        foreign = ticket_service.create_ticket(
            project=self.itreq, ticket_type=self.itreq.ticket_types.first(),
            summary="foreign", priority="medium", apply_routing=False,
        )
        client = APIClient()
        client.force_authenticate(self.agent)
        ids = {t["id"] for t in client.get(reverse("itsm-ticket-list")).json()["results"]}
        self.assertIn(str(mine.id), ids)
        self.assertNotIn(str(foreign.id), ids)
        # The unassigned project's ticket is 404 by id, too.
        self.assertEqual(
            client.get(reverse("itsm-ticket-detail", args=[foreign.ticket_number])).status_code,
            404,
        )

    # ── assignment guards ────────────────────────────────────────────────────
    def test_add_member_rejects_requestor(self):
        req = User.objects.create_user(username="req", password="x")
        RoleAssignment.objects.create(user=req, role=SystemRole.objects.get(code="requestor"))
        client = APIClient()
        client.force_authenticate(self.sup)
        resp = client.post(
            reverse("itsm-project-add-member", args=[self.itinc.id]),
            {"user": req.id}, format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_create_user_rejects_project_without_its_helpdesk(self):
        client = APIClient()
        client.force_authenticate(self.boss)
        resp = client.post(
            reverse("itsm-member-create-user"),
            {"username": "newbie", "role_code": "agent",
             "helpdesks": [],  # ITINC's helpdesk NOT requested
             "projects": [{"id": str(self.itinc.id)}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class PriorityMatrixSerializerTests(TestCase):
    """ITIL priority-matrix validation: drop bad codes, merge over the default."""

    def test_validate_priority_matrix_merges_and_drops_bad(self):
        from .models import default_priority_matrix
        from .serializers import ProjectWriteSerializer

        out = ProjectWriteSerializer().validate_priority_matrix({
            "high": {"high": "low"},            # valid override
            "bogus": {"x": "y"},                # unknown impact → dropped
            "low": {"high": "critical", "zz": "nope"},  # one valid, one bad urgency
            "medium": {"medium": "banana"},     # bad priority → ignored
        })
        self.assertEqual(out["high"]["high"], "low")        # overridden
        self.assertEqual(out["low"]["high"], "critical")    # overridden
        self.assertNotIn("bogus", out)                       # dropped
        # untouched cells fall back to the standard default
        default = default_priority_matrix()
        self.assertEqual(out["medium"]["medium"], default["medium"]["medium"])
        self.assertEqual(out["high"]["medium"], default["high"]["medium"])
