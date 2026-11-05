"""Helpdesk admin: create (append order), disable (status), reorder, and the
manager-vs-agent list scoping. Mirrors the seed + RBAC setup used elsewhere."""

from django.contrib.auth import get_user_model
from django.db.models import Max
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac

from .models import Helpdesk, HelpdeskMembership
from .seed import run as seed_helpdesks
from .services import accessible_helpdesk_ids, build_helpdesk_membership

User = get_user_model()

BASE = "/api/v1/itsm/helpdesks/"


def _rows(resp):
    data = resp.json()
    return data["results"] if isinstance(data, dict) and "results" in data else data


class HelpdeskAdminTests(TestCase):
    def setUp(self):
        seed_rbac()
        seed_helpdesks()  # IT, HR, FAC (active)
        self.admin = User.objects.create_superuser(username="adm", password="x", email="a@a.io")
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        # the agent is an active member of IT only
        self.it = Helpdesk.objects.get(key="IT")
        HelpdeskMembership.objects.create(helpdesk=self.it, user=self.agent, is_active=True)
        self.client = APIClient()

    # --- ordering source -------------------------------------------------
    def test_home_membership_sorted_by_order(self):
        # seed/backfill gives a deterministic order; the payload follows `order`.
        keys = [h["key"] for h in build_helpdesk_membership(self.admin)]
        ordered = list(Helpdesk.objects.filter(status="active").order_by("order", "name")
                       .values_list("key", flat=True))
        self.assertEqual(keys, ordered)

    # --- create appends --------------------------------------------------
    def test_create_appends_to_order(self):
        self.client.force_authenticate(self.admin)
        before = Helpdesk.objects.aggregate(m=Max("order"))["m"] or 0
        resp = self.client.post(BASE, {"name": "Legal Helpdesk", "key": "LEG"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(Helpdesk.objects.get(key="LEG").order, before + 1)

    def test_agent_cannot_create(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.post(BASE, {"name": "Nope", "key": "NOPE"}, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)

    # --- disable / enable ------------------------------------------------
    def test_disable_removes_from_home_and_scope(self):
        self.assertIn("IT", [h["key"] for h in build_helpdesk_membership(self.agent)])
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(f"{BASE}{self.it.id}/", {"status": "inactive"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertNotIn("IT", [h["key"] for h in build_helpdesk_membership(self.agent)])
        self.assertEqual(accessible_helpdesk_ids(self.agent), [])  # only-membership disabled
        # re-enable restores access
        self.client.patch(f"{BASE}{self.it.id}/", {"status": "active"}, format="json")
        self.assertIn("IT", [h["key"] for h in build_helpdesk_membership(self.agent)])

    # --- reorder ---------------------------------------------------------
    def test_reorder_changes_home_order(self):
        self.client.force_authenticate(self.admin)
        ids = [str(h.id) for h in Helpdesk.objects.filter(status="active").order_by("-name")]
        resp = self.client.post(f"{BASE}reorder/", {"order": ids}, format="json")
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertEqual([h["id"] for h in build_helpdesk_membership(self.admin)], ids)

    # --- list scoping ----------------------------------------------------
    def test_manager_sees_inactive_agent_does_not(self):
        self.it.status = "inactive"
        self.it.save(update_fields=["status"])
        self.client.force_authenticate(self.admin)
        self.assertIn("IT", [r["key"] for r in _rows(self.client.get(BASE))])
        self.client.force_authenticate(self.agent)
        self.assertNotIn("IT", [r["key"] for r in _rows(self.client.get(BASE))])


class HelpdeskCreateProvisioningTests(TestCase):
    """B23: a helpdesk created from the UI gets its creator as Lead and (opt-in) the
    standard Incident + Service Request projects via the catalog import service."""

    def setUp(self):
        from apps.itsm_groups.seed import run as seed_groups
        from apps.itsm_projects.seed import run as seed_projects
        from apps.itsm_workflows.seed import run as seed_workflows

        seed_rbac()
        seed_helpdesks()
        seed_workflows()
        seed_groups()
        seed_projects()
        self.sup = User.objects.create_user(username="sup23", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.client = APIClient()
        self.client.force_authenticate(self.sup)

    def _create(self, **body):
        payload = {"name": "Legal Helpdesk", "key": "LEG"}
        payload.update(body)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(BASE, payload, format="json")

    def test_creator_is_lead_and_standard_projects_imported(self):
        from apps.itsm_projects.models import Project, ProjectMembership

        resp = self._create(with_standard_projects=True)
        self.assertEqual(resp.status_code, 201, resp.content)
        hd = Helpdesk.objects.get(key="LEG")
        m = HelpdeskMembership.objects.get(helpdesk=hd, user=self.sup)
        self.assertEqual((m.role_in_helpdesk, m.is_active), ("lead", True))
        keys = set(Project.objects.filter(helpdesk=hd).values_list("key", flat=True))
        self.assertEqual(keys, {"LEGINC", "LEGREQ"})
        self.assertEqual(sorted(resp.json()["standard_projects"]["imported"]), ["LEGINC", "LEGREQ"])
        self.assertEqual(resp.json()["standard_projects"]["errors"], [])
        self.assertEqual(
            ProjectMembership.objects.filter(project__helpdesk=hd, user=self.sup).count(), 2)
        self.assertIn("LEG", [h["key"] for h in build_helpdesk_membership(self.sup)])

    def test_without_flag_no_projects_but_creator_is_lead(self):
        from apps.itsm_projects.models import Project

        resp = self._create()
        self.assertEqual(resp.status_code, 201, resp.content)
        hd = Helpdesk.objects.get(key="LEG")
        self.assertFalse(Project.objects.filter(helpdesk=hd).exists())
        self.assertTrue(HelpdeskMembership.objects.filter(
            helpdesk=hd, user=self.sup, role_in_helpdesk="lead").exists())
        self.assertNotIn("standard_projects", resp.json())

    def test_superuser_creator_also_becomes_lead(self):
        root = User.objects.create_superuser(username="root23", password="x")
        self.client.force_authenticate(root)
        self.assertEqual(self._create().status_code, 201)
        self.assertTrue(HelpdeskMembership.objects.filter(
            helpdesk__key="LEG", user=root, role_in_helpdesk="lead").exists())

    def test_key_squatter_reports_error_but_creates_the_rest(self):
        from apps.itsm_projects.models import Project

        it = Helpdesk.objects.get(key="IT")
        Project.objects.create(helpdesk=it, key="LEGINC", name="Squatter", project_type="custom")
        resp = self._create(with_standard_projects=True)
        self.assertEqual(resp.status_code, 201, resp.content)
        report = resp.json()["standard_projects"]
        self.assertEqual(report["imported"], ["LEGREQ"])
        self.assertEqual(len(report["errors"]), 1)
        self.assertIn("Incident Management", report["errors"][0])

    def test_inactive_status_reports_errors_and_imports_nothing(self):
        from apps.itsm_projects.models import Project

        resp = self._create(with_standard_projects=True, status="inactive")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["standard_projects"]["imported"], [])
        self.assertEqual(len(resp.json()["standard_projects"]["errors"]), 2)
        self.assertFalse(Project.objects.filter(helpdesk__key="LEG").exists())
