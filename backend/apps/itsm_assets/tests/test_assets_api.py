"""Asset register API: create/update rules, tags, details, expiry, scoping, RBAC."""

from __future__ import annotations

import datetime as dt
import io

from apps.itsm_rbac.models import SystemRole

from ..models import Asset, AssetEvent, AssetFieldValue, Department, Location, Vendor
from ..services.parsing import org_today
from .base import API, AssetTestCase, make_user, set_perm


class CreateAssetTests(AssetTestCase):
    def test_create_minimal_auto_tag_default_status_and_history(self):
        r = self.new_asset()
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body["asset_tag"], "IT-AST-00001")
        self.assertEqual(body["status"]["name"], "In Stock")
        self.assertEqual(body["details"]["serial_number"], "SN-1")
        keys = [f["key"] for f in body["detail_fields"]]
        self.assertIn("screen_size", keys)       # Laptop's own field
        self.assertIn("operating_system", keys)  # inherited from Computer
        inherited = {f["key"]: f["inherited"] for f in body["detail_fields"]}
        self.assertTrue(inherited["operating_system"])
        self.assertFalse(inherited["screen_size"])
        events = AssetEvent.objects.filter(asset_id=body["id"])
        self.assertEqual([e.action for e in events], ["created"])

    def test_required_detail_field(self):
        r = self.new_asset(details={})
        self.assertEqual(r.status_code, 400)
        self.assertIn("details.serial_number", r.json()["errors"])

    def test_detail_type_validation_and_dropdown_label(self):
        r = self.new_asset(details={"serial_number": "SN-9", "ram_gb": "lots",
                                    "operating_system": "Windows 12"})
        self.assertEqual(r.status_code, 400)
        errs = r.json()["errors"]
        self.assertIn("details.ram_gb", errs)
        self.assertIn("details.operating_system", errs)
        r = self.new_asset(details={"serial_number": "SN-9", "ram_gb": "16",
                                    "operating_system": "windows 11", "purchase": "x"})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["details"]["operating_system"], "windows_11")
        self.assertEqual(r.json()["details"]["ram_gb"], "16")

    def test_sub_category_must_belong_to_category(self):
        r = self.new_asset(category=str(self.server.id), sub_category=str(self.laptop.id))
        self.assertEqual(r.status_code, 400)
        self.assertIn("sub_category", r.json()["errors"])

    def test_sub_category_as_category_refused(self):
        r = self.new_asset(category=str(self.laptop.id), sub_category=None)
        self.assertEqual(r.status_code, 400)
        self.assertIn("category", r.json()["errors"])

    def test_category_of_another_helpdesk(self):
        from ..services.starter import load_starter
        load_starter(self.hr)
        hr_cat = self.hr.asset_categories.get(name="Monitor")
        r = self.new_asset(category=str(hr_cat.id), sub_category=None, details={"serial_number": "x"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("category", r.json()["errors"])

    def test_inaccessible_helpdesk_403(self):
        self.as_user(self.agent)
        r = self.new_asset(helpdesk=str(self.hr.id))
        self.assertEqual(r.status_code, 403)

    def test_in_use_needs_user_or_department(self):
        r = self.new_asset(status=str(self.status["in_use"].id))
        self.assertEqual(r.status_code, 400)
        self.assertIn("assigned_user", r.json()["errors"])
        dept = Department.objects.create(name="Finance")
        r = self.new_asset(status=str(self.status["in_use"].id), department=str(dept.id))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertIsNotNone(r.json()["allotted_at"])
        r = self.new_asset(status=str(self.status["in_use"].id), assigned_user=self.agent.pk)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["assigned_user"]["username"], "agent1")

    def test_dates_before_purchase(self):
        r = self.new_asset(purchase_date="2026-01-10", warranty_expiry_date="2025-12-31")
        self.assertEqual(r.status_code, 400)
        self.assertIn("warranty_expiry_date", r.json()["errors"])

    def test_inactive_master_cannot_be_picked(self):
        v = Vendor.objects.create(name="Old Vendor", is_active=False)
        r = self.new_asset(vendor=str(v.id))
        self.assertEqual(r.status_code, 400)
        self.assertIn("vendor", r.json()["errors"])


class TagTests(AssetTestCase):
    def test_tag_unique_ignoring_case_and_reusable_after_delete(self):
        self.assertEqual(self.new_asset(asset_tag="LAP-1").status_code, 201)
        r = self.new_asset(asset_tag="lap-1")
        self.assertEqual(r.status_code, 400)
        self.assertIn("asset_tag", r.json()["errors"])
        first = Asset.objects.get(asset_tag="LAP-1")
        self.assertEqual(self.client.delete(f"{API}/assets/{first.id}/").status_code, 204)
        self.assertEqual(self.new_asset(asset_tag="lap-1").status_code, 201)

    def test_auto_tag_skips_numbers_typed_by_hand(self):
        self.assertEqual(self.new_asset(asset_tag="IT-AST-00001").status_code, 201)
        r = self.new_asset()
        self.assertEqual(r.json()["asset_tag"], "IT-AST-00002")

    def test_update_tag_conflict(self):
        a = self.new_asset(asset_tag="A-1").json()
        self.new_asset(asset_tag="B-1")
        r = self.client.patch(f"{API}/assets/{a['id']}/", {"asset_tag": "b-1"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"{API}/assets/{a['id']}/", {"asset_tag": ""}, format="json")
        self.assertEqual(r.status_code, 400)


class UpdateAssetTests(AssetTestCase):
    def test_update_records_history_and_allotment_stamp(self):
        a = self.new_asset().json()
        loc = Location.objects.create(name="Noida")
        r = self.client.patch(f"{API}/assets/{a['id']}/", {
            "location": str(loc.id), "status": str(self.status["in_use"].id),
            "assigned_user": self.agent.pk}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNotNone(r.json()["allotted_at"])
        ev = AssetEvent.objects.filter(asset_id=a["id"], action="updated").get()
        changed = {c["field"]: (c["old"], c["new"]) for c in ev.changes}
        self.assertEqual(changed["status"], ("In Stock", "In Use"))
        self.assertEqual(changed["location"], (None, "Noida"))
        self.assertEqual(changed["assigned_user"], (None, "Ann Agent"))

    def test_category_change_drops_values_that_no_longer_apply(self):
        a = self.new_asset(details={"serial_number": "SN-1", "screen_size": "14"}).json()
        r = self.client.patch(f"{API}/assets/{a['id']}/", {
            "sub_category": str(self.desktop.id)}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertNotIn("screen_size", r.json()["details"])
        self.assertFalse(AssetFieldValue.objects.filter(
            asset_id=a["id"], field=self.field["screen_size"]).exists())
        ev = AssetEvent.objects.filter(asset_id=a["id"], action="updated").get()
        dropped = [c for c in ev.changes if c.get("dropped")]
        self.assertEqual(dropped[0]["label"], "Screen Size (inches)")
        self.assertEqual(dropped[0]["old"], "14")

    def test_category_change_needs_new_required_fields(self):
        a = self.new_asset().json()
        r = self.client.patch(f"{API}/assets/{a['id']}/", {
            "category": str(self.server.id), "sub_category": str(self.vm.id)}, format="json")
        self.assertEqual(r.status_code, 400)
        errs = r.json()["errors"]
        self.assertIn("details.hostname", errs)
        self.assertIn("details.ip_address", errs)

    def test_deactivated_field_keeps_its_value(self):
        a = self.new_asset(details={"serial_number": "SN-1", "hostname": "lap-01"}).json()
        f = self.field["hostname"]
        f.is_active = False
        f.save()
        r = self.client.patch(f"{API}/assets/{a['id']}/", {"name": "Renamed"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(AssetFieldValue.objects.filter(asset_id=a["id"], field=f).exists())


class ExpiryRuleTests(AssetTestCase):
    def test_past_expiry_with_active_status_refused(self):
        past = (org_today() - dt.timedelta(days=3)).isoformat()
        r = self.new_asset(expiry_date=past)
        self.assertEqual(r.status_code, 400)
        self.assertIn("status", r.json()["errors"])
        r = self.new_asset(expiry_date=past, status=str(self.status["expired"].id))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.json()["expiry_passed"])

    def test_unchanged_status_past_expiry_is_marked_expired_on_save(self):
        future = (org_today() + dt.timedelta(days=10)).isoformat()
        a = self.new_asset(expiry_date=future).json()
        Asset.objects.filter(pk=a["id"]).update(expiry_date=org_today() - dt.timedelta(days=1))
        r = self.client.patch(f"{API}/assets/{a['id']}/", {"allotment_notes": "spare"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"]["name"], "Expired")
        self.assertTrue(AssetEvent.objects.filter(asset_id=a["id"], action="auto_expired").exists())


class ScopeAndPermissionTests(AssetTestCase):
    def test_other_helpdesk_cannot_see_or_open(self):
        a = self.new_asset().json()
        self.as_user(self.hr_agent)
        r = self.client.get(f"{API}/assets/")
        self.assertEqual(r.json()["count"], 0)
        self.assertEqual(self.client.get(f"{API}/assets/{a['id']}/").status_code, 404)
        r = self.client.get(f"{API}/assets/?helpdesk={self.it.id}")
        self.assertEqual(r.json()["count"], 0)  # ?helpdesk never widens scope

    def test_agent_can_create_and_edit_but_not_delete(self):
        self.as_user(self.agent)
        r = self.new_asset()
        self.assertEqual(r.status_code, 201, r.content)
        aid = r.json()["id"]
        self.assertEqual(self.client.patch(f"{API}/assets/{aid}/", {"name": "x"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"{API}/assets/{aid}/").status_code, 403)

    def test_requestor_has_no_access(self):
        self.as_user(self.requestor)
        self.assertEqual(self.client.get(f"{API}/assets/").status_code, 403)
        self.assertEqual(self.client.get(f"{API}/asset-statuses/").status_code, 403)
        self.assertEqual(self.client.get(f"{API}/asset-users/?search=a").status_code, 403)

    def test_custom_role_needs_explicit_grant(self):
        role = SystemRole.objects.create(code="assetkeeper", name="Asset keeper")
        u = make_user("keeper", "assetkeeper", self.it)
        self.as_user(u)
        self.assertEqual(self.client.get(f"{API}/assets/").status_code, 403)
        set_perm(role, "itsm.assets", can_read=True)
        self.assertEqual(self.client.get(f"{API}/assets/").status_code, 200)
        # Lookups and the user picker open with Assets read alone.
        self.assertEqual(self.client.get(f"{API}/asset-statuses/").status_code, 200)
        self.assertEqual(self.client.get(f"{API}/asset-users/?search=ann").status_code, 200)
        self.assertEqual(self.client.post(f"{API}/asset-statuses/", {
            "name": "Loaned", "state_type": "in_use"}, format="json").status_code, 403)


class ListFilterSummaryTests(AssetTestCase):
    def setUp(self):
        super().setUp()
        self.loc = Location.objects.create(name="Noida")
        self.new_asset(name="Laptop A", details={"serial_number": "ZX-81", "hostname": "alpha"},
                       location=str(self.loc.id))
        self.new_asset(name="Laptop B", status=str(self.status["in_use"].id),
                       assigned_user=self.agent.pk,
                       warranty_expiry_date=(org_today() + dt.timedelta(days=5)).isoformat())
        self.new_asset(name="Printer P", category=str(self.printer.id), sub_category=None,
                       details={"serial_number": "PR-1"}, status=str(self.status["lost"].id))

    def _names(self, query=""):
        r = self.client.get(f"{API}/assets/{query}")
        self.assertEqual(r.status_code, 200, r.content)
        return sorted(a["name"] for a in r.json()["results"])

    def test_filters(self):
        self.assertEqual(self._names("?state_type=in_use"), ["Laptop B"])
        self.assertEqual(self._names("?state_type=active"), ["Laptop A", "Laptop B"])
        self.assertEqual(self._names(f"?location={self.loc.id}"), ["Laptop A"])
        self.assertEqual(self._names("?location=none"), ["Laptop B", "Printer P"])
        self.assertEqual(self._names(f"?category={self.printer.id}"), ["Printer P"])
        self.assertEqual(self._names("?warranty=expiring"), ["Laptop B"])
        self.assertEqual(self._names("?search=zx-8"), ["Laptop A"])      # detail value
        self.assertEqual(self._names("?search=ann"), ["Laptop B"])       # allotted user
        r = self.client.get(f"{API}/assets/?ordering=-name")
        self.assertEqual([a["name"] for a in r.json()["results"]], ["Printer P", "Laptop B", "Laptop A"])
        r = self.client.get(f"{API}/assets/?ordering=bogus")
        self.assertEqual(r.status_code, 200)

    def test_summary_and_report(self):
        s = self.client.get(f"{API}/assets/summary/?helpdesk={self.it.id}").json()
        self.assertEqual(s["total"], 3)
        self.assertEqual(s["active"], 2)
        by_state = {x["key"]: x["count"] for x in s["by_state_type"]}
        self.assertEqual(by_state["missing"], 1)
        self.assertEqual(s["warranty_expiring"], 1)
        self.assertEqual(s["warranty_ending"][0]["name"], "Laptop B")
        cats = {x["label"]: x["count"] for x in s["by_category"]}
        self.assertEqual(cats, {"Computer": 2, "Printer": 1})
        rep = self.client.get(f"{API}/assets/report/?group_by=location").json()
        self.assertEqual(rep["total"]["count"], 3)
        labels = {x["label"]: x["count"] for x in rep["rows"]}
        self.assertEqual(labels, {"No location": 2, "Noida": 1})
        rep = self.client.get(f"{API}/assets/report/?group_by=assigned_user").json()
        self.assertIn("Ann Agent", [x["label"] for x in rep["rows"]])

    def test_export_workbook_with_formula_guard(self):
        self.new_asset(name="=HYPERLINK(\"http://evil\")", details={"serial_number": "+1"})
        r = self.client.get(f"{API}/assets/export/?helpdesk={self.it.id}&group_by=status")
        self.assertEqual(r.status_code, 200)
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        self.assertEqual(wb.sheetnames, ["Summary", "Assets"])
        ws = wb["Assets"]
        headers = [c.value for c in ws[1]]
        self.assertIn("Serial Number", headers)
        self.assertIn("Operating System", headers)
        names = {ws.cell(row=i, column=2).value: ws.cell(row=i, column=2) for i in range(2, ws.max_row + 1)}
        evil = names['=HYPERLINK("http://evil")']
        self.assertEqual(evil.data_type, "s")
        self.assertTrue(evil.quotePrefix)
        self.assertEqual(ws.freeze_panes, "C2")

    def test_export_needs_helpdesk(self):
        self.assertEqual(self.client.get(f"{API}/assets/export/").status_code, 400)

    def test_form_fields_and_history(self):
        r = self.client.get(f"{API}/assets/form-fields/?category={self.server.id}&sub_category={self.vm.id}")
        keys = [f["key"] for f in r.json()]
        self.assertIn("hypervisor", keys)
        self.assertIn("ip_address", keys)
        a = Asset.objects.get(name="Laptop A")
        hist = self.client.get(f"{API}/assets/{a.id}/history/").json()
        self.assertEqual(hist[0]["action"], "created")
        self.assertEqual(hist[0]["actor"]["username"], "admin1")
