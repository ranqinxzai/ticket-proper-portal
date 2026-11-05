"""Asset Management phase 2: tickets ↔ assets (create, links, portal, report, asset page)."""

from __future__ import annotations

import datetime as dt
import importlib

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_assets.models import Asset, AssetCategory, AssetEvent, AssetStatus
from apps.itsm_assets.services.starter import load_starter
from apps.itsm_core.models import AuditEvent, FieldDefinition, FieldLayoutItem
from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership
from apps.itsm_rbac.models import RoleAssignment, SystemRole

from .models import Ticket, TicketAsset
from .services import ticket_service
from .tests import _project, _seed_min

User = get_user_model()
MIGRATION = importlib.import_module("apps.itsm_core.migrations.0018_asset_system_field")


def _user(username, role, helpdesk=None, **kw):
    u = User.objects.create_user(username=username, password="x", email=f"{username}@ex.com",
                                 full_name=username.title(), **kw)
    RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code=role))
    if helpdesk is not None:
        HelpdeskMembership.objects.create(helpdesk=helpdesk, user=u, is_active=True)
    return u


def _asset(helpdesk, tag, category, user=None, status_key="in_use"):
    return Asset.objects.create(helpdesk=helpdesk, name=f"Asset {tag}", asset_tag=tag,
                                category=category, status=AssetStatus.objects.get(key=status_key),
                                assigned_user=user)


class TicketAssetBase(TestCase):
    def setUp(self):
        _seed_min()
        self.it = Helpdesk.objects.get(key="IT")
        self.hr = Helpdesk.objects.get(key="HR")
        load_starter(self.it)
        self.computer = AssetCategory.objects.get(helpdesk=self.it, name="Computer", parent=None)
        self.inc = _project("IT", "incident")
        self.tt = self.inc.ticket_types.get(key="incident")
        self.agent = _user("agent", "agent", self.it)
        from apps.itsm_projects.models import Project, ProjectMembership
        for p in Project.objects.filter(helpdesk=self.it):
            ProjectMembership.objects.create(project=p, user=self.agent, is_active=True)
        self.req = _user("req", "requestor")
        self.other = _user("other", "requestor")
        self.a1 = _asset(self.it, "IT-1", self.computer, self.req)
        self.a2 = _asset(self.it, "IT-2", self.computer, self.req)
        self.a3 = _asset(self.it, "IT-3", self.computer, self.other)
        hr_cat = AssetCategory.objects.create(helpdesk=self.hr, name="Furniture")
        self.hr_asset = _asset(self.hr, "HR-1", hr_cat, self.req)
        self.c = APIClient()
        self.c.force_authenticate(self.agent)

    def _create(self, **extra):
        body = {"project": str(self.inc.id), "ticket_type": str(self.tt.id), "summary": "Broken",
                "description_html": "<p>Screen flickers</p>", "requestor": str(self.req.pk)}
        body.update(extra)
        return self.c.post(reverse("itsm-ticket-list"), body, format="json")

    def _layout_item(self):
        field = FieldDefinition.objects.get(project__isnull=True, key="asset")
        return FieldLayoutItem.objects.get(layout__project=self.inc, layout__ticket_type__isnull=True,
                                           field=field)


class CreateWithAssetsTests(TicketAssetBase):
    def test_create_links_in_order_with_history_on_both_sides(self):
        with self.captureOnCommitCallbacks(execute=True):
            r = self._create(assets=[str(self.a2.id), str(self.a1.id)])
        self.assertEqual(r.status_code, 201, r.content)
        t = Ticket.objects.get(pk=r.json()["id"])
        self.assertEqual(t.primary_asset_id, self.a2.id)
        links = list(TicketAsset.objects.filter(ticket=t).values_list("asset__asset_tag", "position"))
        self.assertEqual(links, [("IT-2", 0), ("IT-1", 1)])
        self.assertEqual([a["asset_tag"] for a in r.json()["assets"]], ["IT-2", "IT-1"])
        self.assertTrue(r.json()["assets"][0]["is_primary"])
        self.assertEqual(r.json()["primary_asset"]["asset_tag"], "IT-2")
        actions = list(AuditEvent.objects.filter(ticket=t).order_by("created_at")
                       .values_list("action", flat=True))
        self.assertEqual(actions[:2], ["ticket_created", "asset_linked"])
        ev = AssetEvent.objects.get(asset=self.a1, action="ticket_linked")
        self.assertIn(t.ticket_number, ev.note)

    def test_other_helpdesk_asset_refused(self):
        r = self._create(assets=[str(self.hr_asset.id)])
        self.assertEqual(r.status_code, 400)
        self.assertIn("asset", r.json())
        self.assertFalse(Ticket.objects.filter(summary="Broken").exists())

    def test_unknown_or_garbage_id_refused(self):
        self.assertEqual(self._create(assets=["not-a-uuid"]).status_code, 400)

    def test_required_asset_field(self):
        item = self._layout_item()
        item.is_hidden, item.is_mandatory = False, True
        item.save()
        r = self._create()
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json(), {"asset": ["Asset is required."]})
        self.assertEqual(self._create(assets=[str(self.a1.id)]).status_code, 201)

    def test_hidden_required_field_does_not_block(self):
        item = self._layout_item()
        item.is_hidden, item.is_mandatory = True, True
        item.save()
        self.assertEqual(self._create().status_code, 201)


class LinkEndpointTests(TicketAssetBase):
    def setUp(self):
        super().setUp()
        self.t = ticket_service.create_ticket(project=self.inc, ticket_type=self.tt, summary="X",
                                              requestor=self.req, user=self.agent,
                                              apply_routing=False)

    def _post(self, path, body):
        return self.c.post(f"/api/v1/itsm/tickets/{self.t.id}/{path}", body, format="json")

    def test_link_unlink_primary_flow(self):
        with self.captureOnCommitCallbacks(execute=True):
            r = self._post("assets/", {"assets": [str(self.a1.id), str(self.a3.id)]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([a["asset_tag"] for a in r.json()["assets"]], ["IT-1", "IT-3"])
        self.t.refresh_from_db()
        self.assertEqual(self.t.primary_asset_id, self.a1.id)
        self.assertEqual(self.t.updated_by, self.agent)
        # Already linked → skipped, no duplicate.
        self._post("assets/", {"assets": [str(self.a1.id)]})
        self.assertEqual(TicketAsset.objects.filter(ticket=self.t).count(), 2)
        r = self._post("assets/primary/", {"asset": str(self.a3.id)})
        self.assertEqual([a["asset_tag"] for a in r.json()["assets"]], ["IT-3", "IT-1"])
        self.t.refresh_from_db()
        self.assertEqual(self.t.primary_asset_id, self.a3.id)
        with self.captureOnCommitCallbacks(execute=True):
            r = self._post("assets/unlink/", {"asset": str(self.a3.id)})
        self.assertEqual([a["asset_tag"] for a in r.json()["assets"]], ["IT-1"])
        self.t.refresh_from_db()
        self.assertEqual(self.t.primary_asset_id, self.a1.id)
        self.assertTrue(TicketAsset.all_objects.filter(ticket=self.t, asset=self.a3,
                                                       is_deleted=True).exists())
        self.assertTrue(AuditEvent.objects.filter(ticket=self.t, action="asset_unlinked").exists())
        self.assertTrue(AssetEvent.objects.filter(asset=self.a3, action="ticket_unlinked").exists())
        # Re-link after unlink adds a fresh live row (live-only unique).
        r = self._post("assets/", {"assets": [str(self.a3.id)]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(TicketAsset.objects.filter(ticket=self.t).count(), 2)
        # Unlink everything → no primary.
        self._post("assets/unlink/", {"asset": str(self.a1.id)})
        self._post("assets/unlink/", {"asset": str(self.a3.id)})
        self.t.refresh_from_db()
        self.assertIsNone(self.t.primary_asset_id)

    def test_errors(self):
        self.assertEqual(self._post("assets/", {"assets": [str(self.hr_asset.id)]}).status_code, 400)
        self.assertEqual(self._post("assets/unlink/", {"asset": str(self.a1.id)}).status_code, 400)
        self.assertEqual(self._post("assets/primary/", {"asset": str(self.a1.id)}).status_code, 400)

    def test_stale_write_guard(self):
        old = "2000-01-01T00:00:00Z"
        r = self._post("assets/", {"assets": [str(self.a1.id)], "expected_updated_at": old})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["code"], "stale_write")

    def test_requestor_cannot_use_agent_endpoint(self):
        c = APIClient()
        c.force_authenticate(self.req)
        r = c.post(f"/api/v1/itsm/tickets/{self.t.id}/assets/", {"assets": [str(self.a1.id)]},
                   format="json")
        self.assertIn(r.status_code, (403, 404))

    def test_get_and_list_shapes(self):
        self._post("assets/", {"assets": [str(self.a1.id)]})
        r = self.c.get(f"/api/v1/itsm/tickets/{self.t.id}/assets/")
        self.assertEqual(r.json()[0]["assigned_user"]["username"], "req")
        lst = self.c.get(reverse("itsm-ticket-list")).json()["results"]
        row = next(x for x in lst if x["id"] == str(self.t.id))
        self.assertEqual(row["primary_asset"]["asset_tag"], "IT-1")


class PortalAssetTests(TicketAssetBase):
    def setUp(self):
        super().setUp()
        self.req_project = _project("IT", "service_request")
        item = FieldLayoutItem.objects.get(layout__project=self.req_project,
                                           layout__ticket_type__isnull=True, field__key="asset")
        item.is_hidden, item.portal_visible = False, True
        item.save()
        self.pc = APIClient()
        self.pc.force_authenticate(self.req)

    def test_my_assets_only_own_active(self):
        _asset(self.it, "IT-OLD", self.computer, self.req, status_key="disposed")
        r = self.pc.get(f"/api/v1/itsm/portal/request-intake/my-assets/?project={self.req_project.id}")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(sorted(a["asset_tag"] for a in r.json()), ["IT-1", "IT-2"])

    def _portal_create(self, ids):
        return self.pc.post("/api/v1/itsm/portal/request-intake/", {
            "project": str(self.req_project.id),
            "fields": {"summary": "My laptop", "description": "<p>x</p>", "priority": "p3",
                       "asset": ids},
        }, format="json")

    def test_portal_create_own_asset_and_refuse_others(self):
        r = self._portal_create([str(self.a3.id)])
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("asset", r.json())
        r = self._portal_create([str(self.a1.id)])
        self.assertEqual(r.status_code, 201, r.content)
        t = Ticket.objects.get(pk=r.json()["id"])
        self.assertEqual(t.primary_asset_id, self.a1.id)
        d = self.pc.get(f"/api/v1/itsm/portal/requests/{t.ticket_number}/").json()
        self.assertEqual(d["field_values"]["asset"], ["IT-1 · Asset IT-1"])


class ReportAndAssetPageTests(TicketAssetBase):
    def test_ticket_data_columns(self):
        from apps.itsm_reporting.services import reports

        t = ticket_service.create_ticket(project=self.inc, ticket_type=self.tt, summary="R",
                                         requestor=self.req, user=self.agent, apply_routing=False,
                                         assets=[self.a2, self.a1])
        data = reports.ticket_data(project=str(self.inc.id))
        keys = [c["key"] for c in data["columns"]]
        self.assertIn("asset", keys)
        self.assertIn("all_assets", keys)
        row = next(r for r in data["rows"] if r["ticket_number"] == t.ticket_number)
        self.assertEqual(row["asset"], "IT-2 · Asset IT-2")
        self.assertEqual(row["all_assets"], "IT-2, IT-1")

    def test_asset_tickets_open_first_and_scoped(self):
        t1 = ticket_service.create_ticket(project=self.inc, ticket_type=self.tt, summary="Old",
                                          requestor=self.req, user=self.agent, apply_routing=False,
                                          assets=[self.a1])
        t2 = ticket_service.create_ticket(project=self.inc, ticket_type=self.tt, summary="New",
                                          requestor=self.req, user=self.agent, apply_routing=False,
                                          assets=[self.a2, self.a1])
        from apps.itsm_workflows.models import Status
        done = Status.objects.filter(workflow=t2.workflow, category__key="done").first()
        Ticket.objects.filter(pk=t2.pk).update(status=done)
        r = self.c.get(f"/api/v1/itsm/assets/{self.a1.id}/tickets/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual((body["count"], body["open_count"]), (2, 1))
        self.assertEqual([x["ticket_number"] for x in body["results"]],
                         [t1.ticket_number, t2.ticket_number])
        self.assertTrue(body["results"][0]["is_primary"])
        self.assertFalse(body["results"][1]["is_primary"])
        hr_agent = _user("hra", "agent", self.hr)
        c = APIClient()
        c.force_authenticate(hr_agent)
        self.assertEqual(c.get(f"/api/v1/itsm/assets/{self.a1.id}/tickets/").status_code, 404)

    def test_ticket_hidden_by_project_whitelist(self):
        """An agent restricted to other projects never sees this asset's tickets."""
        from apps.itsm_projects.models import ProjectMembership

        ticket_service.create_ticket(project=self.inc, ticket_type=self.tt, summary="Secret",
                                     requestor=self.req, user=self.agent, apply_routing=False,
                                     assets=[self.a1])
        limited = _user("limited", "agent", self.it)
        ProjectMembership.objects.create(project=_project("IT", "service_request"), user=limited,
                                         is_active=True)
        c = APIClient()
        c.force_authenticate(limited)
        r = c.get(f"/api/v1/itsm/assets/{self.a1.id}/tickets/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["count"], 0)


class AssetFieldPlacementTests(TestCase):
    def setUp(self):
        _seed_min()
        self.it = Helpdesk.objects.get(key="IT")

    def _item(self, helpdesk_key, project_type="incident"):
        return FieldLayoutItem.objects.filter(
            layout__project=_project(helpdesk_key, project_type),
            layout__ticket_type__isnull=True, field__key="asset").first()

    def test_seed_places_hidden_without_categories(self):
        field = FieldDefinition.objects.get(project__isnull=True, key="asset")
        self.assertEqual((field.field_type, field.config["maps_to"], field.is_system),
                         ("asset_picker", "assets", True))
        self.assertTrue(self._item("IT").is_hidden)

    def test_migration_visible_where_categories_exist_and_idempotent(self):
        FieldLayoutItem.objects.filter(field__key="asset").delete()
        load_starter(self.it)
        MIGRATION.forwards(django_apps, None)
        MIGRATION.forwards(django_apps, None)
        self.assertFalse(self._item("IT").is_hidden)
        self.assertTrue(self._item("HR").is_hidden)
        self.assertEqual(FieldLayoutItem.objects.filter(field__key="asset",
                                                        layout__project__helpdesk=self.it,
                                                        layout__ticket_type__isnull=True).count(), 2)
        item = self._item("IT")
        self.assertEqual((item.section, item.region, item.portal_visible), ("People", "sidebar", True))

    def test_migration_keeps_admin_choice(self):
        item = self._item("IT")
        item.is_hidden = False
        item.save()
        MIGRATION.forwards(django_apps, None)
        self.assertFalse(self._item("IT").is_hidden)

    def test_new_project_follows_categories(self):
        from apps.itsm_core.seed import ensure_project_layout
        from apps.itsm_projects.models import Project

        load_starter(self.it)
        p = Project.objects.create(helpdesk=self.it, key="ITNEW", name="New", project_type="custom",
                                   default_workflow=_project("IT", "incident").default_workflow)
        ensure_project_layout(p)
        item = FieldLayoutItem.objects.get(layout__project=p, field__key="asset")
        self.assertFalse(item.is_hidden)

    def test_asset_field_not_usable_on_transition_screens_or_automation(self):
        from apps.itsm_automation.services.catalog import field_catalog

        cat = field_catalog(_project("IT", "incident"))
        keys = {f["key"] for f in cat["update_fields"]} | {f["key"] for f in cat["set_fields"]}
        self.assertNotIn("assets", keys)
        self.assertNotIn("cf:asset", keys)
