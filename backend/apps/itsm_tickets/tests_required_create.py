"""B5: required layout fields on interactive creates (agent + portal) honour
Hidden / visibility rules; system creates (service calls) are never validated."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_core.models import FieldDefinition, FieldLayout, FieldLayoutItem
from apps.itsm_rbac.models import RoleAssignment, SystemRole

from .services import ticket_service
from .tests import _project, _seed_min

User = get_user_model()


class _Base(TestCase):
    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "service_request")
        self.tt = self.proj.ticket_types.first()
        self.layout = FieldLayout.objects.get(project=self.proj, ticket_type__isnull=True)
        self.kind = FieldDefinition.objects.create(
            project=self.proj, key="kind", name="Kind", field_type="text")
        self.detail = FieldDefinition.objects.create(
            project=self.proj, key="detail", name="Detail", field_type="text")

    def _required(self, field, **kw):
        return FieldLayoutItem.objects.create(
            layout=self.layout, field=field, sort_order=900, is_mandatory=True, **kw)


class AgentCreateRequiredTests(_Base):
    def setUp(self):
        super().setUp()
        root = User.objects.create_superuser(username="root6", password="x")
        self.client = APIClient()
        self.client.force_authenticate(root)

    def _post(self, **extra):
        body = {"project": str(self.proj.id), "ticket_type": str(self.tt.id),
                "summary": "Laptop broken", "description_html": "<p>It won't boot</p>"}
        body.update(extra)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(reverse("itsm-ticket-list"), body, format="json")

    def test_missing_required_custom_field_is_400_keyed_by_field(self):
        self._required(self.detail)
        resp = self._post()
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {"detail": ["Detail is required."]})
        resp = self._post(custom_fields={"detail": "Dell 5420"})
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_missing_seeded_description_is_400(self):
        resp = self._post(description_html="")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("description", resp.json())

    def test_rule_hidden_required_field_does_not_block(self):
        self._required(self.detail, visibility_rule={
            "action": "show", "field": "kind", "operator": "eq", "value": "hardware"})
        self.assertEqual(self._post(custom_fields={"kind": "software"}).status_code, 201)
        resp = self._post(custom_fields={"kind": "hardware"})
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("detail", resp.json())

    def test_hidden_required_field_does_not_block(self):
        self._required(self.detail, is_hidden=True)
        self.assertEqual(self._post().status_code, 201)


class PortalCreateRequiredTests(_Base):
    def setUp(self):
        super().setUp()
        self.requestor = User.objects.create_user(username="req6", password="x")
        RoleAssignment.objects.create(
            user=self.requestor, role=SystemRole.objects.get(code="requestor"))
        self.client = APIClient()
        self.client.force_authenticate(self.requestor)

    def _post(self, **fields):
        body = {"summary": "Need a mouse", "description": "<p>x</p>", "priority": "p3"}
        body.update(fields)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(reverse("itsm-portal-intake-list"),
                                    {"project": str(self.proj.id), "fields": body}, format="json")

    def test_rule_hidden_required_field_does_not_block_portal(self):
        self._required(self.detail, visibility_rule={
            "action": "show", "field": "kind", "operator": "eq", "value": "hardware"})
        self.assertEqual(self._post(kind="software").status_code, 201)
        resp = self._post(kind="hardware")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("detail", resp.json())

    def test_required_attachment_does_not_block_portal(self):
        att = FieldDefinition.objects.create(
            project=self.proj, key="evidence", name="Evidence", field_type="attachment")
        self._required(att)
        self.assertEqual(self._post().status_code, 201)


class SystemCreatesUnaffectedTests(_Base):
    """email intake / automation / move / seeds call the service, never the view —
    they must keep working whatever the layout requires."""

    def test_service_create_and_move_ignore_required_fields(self):
        self._required(self.detail)
        user = User.objects.create_user(username="sys6", password="x")
        src = _project("IT", "incident")
        with self.captureOnCommitCallbacks(execute=True):
            t = ticket_service.create_ticket(
                project=src, ticket_type=src.ticket_types.first(), summary="From email",
                source="email", apply_routing=False, user=user)
        self.assertIsNotNone(t.pk)
        with self.captureOnCommitCallbacks(execute=True):
            direct = ticket_service.create_ticket(
                project=self.proj, ticket_type=self.tt, summary="No description",
                apply_routing=False, user=user)
        self.assertIsNotNone(direct.pk)
        from apps.itsm_workflows.models import Status
        target_status = Status.objects.filter(
            workflow=self.proj.default_workflow, is_deleted=False).order_by("sort_order").first()
        with self.captureOnCommitCallbacks(execute=True):
            moved = ticket_service.move_ticket(
                ticket=t, target_project=self.proj, target_ticket_type=self.tt,
                target_status=target_status, user=user)
        moved.refresh_from_db()
        self.assertEqual(moved.project_id, self.proj.id)
