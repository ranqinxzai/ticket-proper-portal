"""Cross-helpdesk isolation tests.

An agent who belongs only to the IT helpdesk must never reach an HR ticket through
ANY surface: the list, ticket detail, create, the bulk endpoint, saved-filter
results, or reports. Superusers see everything; an agent with no membership sees
nothing.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_projects.models import Project
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_tickets.services import ticket_service

from .models import Helpdesk, HelpdeskMembership

User = get_user_model()


def _seed():
    seed_rbac()
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    seed_helpdesks()
    from apps.itsm_workflows.seed import run as seed_workflows
    seed_workflows()
    from apps.itsm_groups.seed import run as seed_groups
    seed_groups()
    from apps.itsm_projects.seed import run as seed_projects
    seed_projects()


def _project(hd_key, ptype):
    return Project.objects.get(helpdesk__key=hd_key, project_type=ptype)


def _ticket(project, summary):
    return ticket_service.create_ticket(
        project=project, ticket_type=project.ticket_types.get(is_default=True),
        summary=summary, priority="high",
    )


class HelpdeskScopingTests(TestCase):
    def setUp(self):
        _seed()
        self.it = Helpdesk.objects.get(key="IT")
        self.hr = Helpdesk.objects.get(key="HR")
        self.it_inc = _project("IT", "incident")
        self.hr_inc = _project("HR", "incident")
        agent_role = SystemRole.objects.get(code="agent")

        self.it_agent = User.objects.create_user(username="ita", password="x")
        RoleAssignment.objects.create(user=self.it_agent, role=agent_role)
        HelpdeskMembership.objects.create(helpdesk=self.it, user=self.it_agent)

        self.hr_agent = User.objects.create_user(username="hra", password="x")
        RoleAssignment.objects.create(user=self.hr_agent, role=agent_role)
        HelpdeskMembership.objects.create(helpdesk=self.hr, user=self.hr_agent)

        self.it_ticket = _ticket(self.it_inc, "IT issue")
        self.hr_ticket = _ticket(self.hr_inc, "HR issue")
        self.client = APIClient()

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    # ── list / detail / create ───────────────────────────────────────────────
    def test_list_excludes_other_helpdesk(self):
        r = self._as(self.it_agent).get("/api/v1/itsm/tickets/")
        nums = [t["ticket_number"] for t in r.json()["results"]]
        self.assertIn(self.it_ticket.ticket_number, nums)
        self.assertNotIn(self.hr_ticket.ticket_number, nums)

    def test_detail_cross_helpdesk_is_404(self):
        r = self._as(self.it_agent).get(f"/api/v1/itsm/tickets/{self.hr_ticket.id}/")
        self.assertEqual(r.status_code, 404)

    def test_create_in_other_helpdesk_is_403(self):
        tt = self.hr_inc.ticket_types.get(is_default=True)
        r = self._as(self.it_agent).post("/api/v1/itsm/tickets/", {
            "project": str(self.hr_inc.id), "ticket_type": str(tt.id),
            "summary": "sneaky", "priority": "low",
        }, format="json")
        self.assertEqual(r.status_code, 403)

    def test_ticket_number_uses_helpdesk_prefix(self):
        self.assertTrue(self.it_ticket.ticket_number.startswith("ITINC-"))
        self.assertTrue(self.hr_ticket.ticket_number.startswith("HRINC-"))

    # ── bulk / saved-filter / reports (the queryset-bypassing surfaces) ───────
    def test_bulk_by_ids_cannot_touch_other_helpdesk(self):
        r = self._as(self.it_agent).post("/api/v1/itsm/tickets/bulk/", {
            "ids": [str(self.hr_ticket.id)], "op": "priority", "value": "low",
        }, format="json")
        self.assertEqual(r.json().get("updated"), 0)
        self.hr_ticket.refresh_from_db()
        self.assertEqual(self.hr_ticket.priority, "high")

    def test_saved_filter_results_are_clamped(self):
        from apps.itsm_dashboards.models import SavedFilter
        sf = SavedFilter.objects.create(
            owner=self.it_agent, name="peek", query_spec={"project": str(self.hr_inc.id)}
        )
        r = self._as(self.it_agent).get(f"/api/v1/itsm/saved-filters/{sf.id}/results/")
        self.assertEqual(r.json(), [])

    def test_reports_reject_foreign_project(self):
        r = self._as(self.it_agent).get(
            f"/api/v1/itsm/reports/open-tickets/?project={self.hr_inc.id}")
        self.assertEqual(r.status_code, 403)

    def test_reports_default_base_is_scoped(self):
        r = self._as(self.it_agent).get("/api/v1/itsm/reports/open-tickets/")
        self.assertEqual(r.json()["data"]["total"], 1)  # only the IT ticket

    # ── auth/me + superuser + no-membership ──────────────────────────────────
    def test_me_lists_only_member_helpdesks(self):
        r = self._as(self.it_agent).get("/api/v1/itsm/auth/me/")
        self.assertEqual(sorted(h["key"] for h in r.json()["helpdesks"]), ["IT"])

    def test_superuser_sees_all_helpdesks(self):
        su = User.objects.create_user(username="root", password="x")
        su.is_superuser = True
        su.is_staff = True
        su.save(update_fields=["is_superuser", "is_staff"])
        r = self._as(su).get("/api/v1/itsm/tickets/")
        nums = [t["ticket_number"] for t in r.json()["results"]]
        self.assertIn(self.it_ticket.ticket_number, nums)
        self.assertIn(self.hr_ticket.ticket_number, nums)

    def test_agent_without_membership_sees_nothing(self):
        nm = User.objects.create_user(username="nm", password="x")
        RoleAssignment.objects.create(user=nm, role=SystemRole.objects.get(code="agent"))
        r = self._as(nm).get("/api/v1/itsm/tickets/")
        self.assertEqual(r.json()["count"], 0)

    def test_helpdesk_param_cannot_widen_scope(self):
        # IT agent passes ?helpdesk=HR (a helpdesk they don't belong to) → ignored,
        # falls back to their accessible set (IT only), never the HR ticket.
        r = self._as(self.it_agent).get(f"/api/v1/itsm/tickets/?helpdesk={self.hr.key}")
        nums = [t["ticket_number"] for t in r.json()["results"]]
        self.assertNotIn(self.hr_ticket.ticket_number, nums)
