"""B4 (2026-10-18): a catalog item that needs approval must name a usable approval
workflow (validated on save), and raising it never creates a ticket without the
approval (refused atomically with a 400)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_approvals.models import ApprovalRequest, ApprovalStage, ApprovalWorkflow
from apps.itsm_catalog.models import CatalogCategory, CatalogItem
from apps.itsm_projects.models import Project
from apps.itsm_tickets.models import Ticket

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


class CatalogApprovalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        _seed()

    def setUp(self):
        self.root = User.objects.create_superuser(username="root", password="x")
        self.boss = User.objects.create_user(username="boss", password="x")
        self.requestor = User.objects.create_user(username="req", password="x", manager=self.boss)
        self.project = Project.objects.get(helpdesk__key="IT", project_type="service_request")
        self.cat = CatalogCategory.objects.create(name="Hardware", slug="hw")
        self.awf = ApprovalWorkflow.objects.create(name="Manager", project=self.project)
        ApprovalStage.objects.create(workflow=self.awf, level=1, name="Manager",
                                     approver_type="requestor_manager")
        self.admin = APIClient()
        self.admin.force_authenticate(self.root)

    def item(self, **kw):
        defaults = {"category": self.cat, "name": "Laptop", "slug": f"laptop-{CatalogItem.objects.count()}",
                    "project": self.project, "requires_approval": True, "approval_workflow": self.awf}
        defaults.update(kw)
        return CatalogItem.objects.create(**defaults)

    def raise_as(self, user, item):
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        RoleAssignment.objects.get_or_create(user=user, defaults={"role": SystemRole.objects.get(code="requestor")})
        c = APIClient()
        c.force_authenticate(user)
        with self.captureOnCommitCallbacks(execute=True):
            return c.post(reverse("itsm-catalog-raise-request", args=[item.id]), {}, format="json")

    def payload(self, **kw):
        body = {"category": str(self.cat.id), "name": "Laptop", "slug": "laptop-api",
                "project": str(self.project.id), "requires_approval": True}
        body.update(kw)
        return body

    def test_serializer_rejects_needs_approval_without_usable_workflow(self):
        url = reverse("itsm-catalog-item-list")
        self.assertEqual(self.admin.post(url, self.payload(), format="json").status_code, 400)
        inactive = ApprovalWorkflow.objects.create(name="Off", is_active=False)
        ApprovalStage.objects.create(workflow=inactive, level=1, name="x", approver_type="requestor_manager")
        resp = self.admin.post(url, self.payload(approval_workflow=str(inactive.id)), format="json")
        self.assertEqual(resp.status_code, 400)
        empty = ApprovalWorkflow.objects.create(name="Empty")
        resp = self.admin.post(url, self.payload(approval_workflow=str(empty.id)), format="json")
        self.assertEqual(resp.status_code, 400)
        other = Project.objects.get(helpdesk__key="IT", project_type="incident")
        scoped = ApprovalWorkflow.objects.create(name="Other project", project=other)
        ApprovalStage.objects.create(workflow=scoped, level=1, name="x", approver_type="requestor_manager")
        resp = self.admin.post(url, self.payload(approval_workflow=str(scoped.id)), format="json")
        self.assertEqual(resp.status_code, 400)
        resp = self.admin.post(url, self.payload(approval_workflow=str(self.awf.id)), format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_raise_refused_when_workflow_missing_no_ticket(self):
        item = self.item(approval_workflow=None)
        before = Ticket.objects.count()
        resp = self.raise_as(self.requestor, item)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("approval isn't set up", resp.data["detail"])
        self.assertEqual(Ticket.objects.count(), before)

    def test_raise_refused_when_workflow_deleted(self):
        item = self.item()
        self.awf.soft_delete()
        self.assertEqual(self.raise_as(self.requestor, item).status_code, 400)

    def test_raise_refused_when_requestor_has_no_manager(self):
        item = self.item()
        nomgr = User.objects.create_user(username="nomgr", password="x")
        before = Ticket.objects.count()
        resp = self.raise_as(nomgr, item)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no manager", resp.data["detail"])
        self.assertEqual(Ticket.objects.count(), before)
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_raise_happy_path_starts_approval(self):
        item = self.item()
        resp = self.raise_as(self.requestor, item)
        self.assertEqual(resp.status_code, 201, resp.data)
        t = Ticket.objects.get(pk=resp.data["id"])
        self.assertTrue(ApprovalRequest.objects.filter(ticket=t, status="pending").exists())

    def test_item_without_approval_raises_normally(self):
        item = self.item(requires_approval=False, approval_workflow=None)
        resp = self.raise_as(self.requestor, item)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertFalse(ApprovalRequest.objects.exists())
