"""Configuration API: statuses, masters, categories, fields, links, starter set, audit."""

from __future__ import annotations

from django.db import IntegrityError, transaction

from apps.itsm_core.models.audit import AdminAuditEvent

from ..models import AssetCategory, AssetCategoryField, AssetField, AssetFieldValue, AssetStatus, Vendor
from ..services.starter import load_starter
from .base import API, AssetTestCase


class StatusTests(AssetTestCase):
    def test_default_moves_and_expire_target_rules(self):
        r = self.client.post(f"{API}/asset-statuses/", {
            "name": "Loaned", "state_type": "in_use", "is_default": True}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(AssetStatus.objects.filter(is_default=True).get().name, "Loaned")
        self.assertEqual(r.json()["key"], "loaned")
        r = self.client.post(f"{API}/asset-statuses/", {
            "name": "Gone", "state_type": "missing", "auto_expire_target": True}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f"{API}/asset-statuses/", {
            "name": "End of life", "state_type": "retired", "auto_expire_target": True}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(AssetStatus.objects.get(auto_expire_target=True).name, "End of life")

    def test_unique_name_ignoring_case(self):
        r = self.client.post(f"{API}/asset-statuses/", {"name": "in stock", "state_type": "available"},
                             format="json")
        self.assertEqual(r.status_code, 400)

    def test_delete_guards(self):
        default = self.status["in_stock"]
        self.assertEqual(self.client.delete(f"{API}/asset-statuses/{default.id}/").status_code, 400)
        self.new_asset(status=str(self.status["lost"].id))
        r = self.client.delete(f"{API}/asset-statuses/{self.status['lost'].id}/")
        self.assertEqual(r.status_code, 400)
        self.assertIn("1 asset uses this status", str(r.json()))
        self.assertEqual(self.client.delete(f"{API}/asset-statuses/{self.status['disposed'].id}/").status_code, 204)

    def test_asset_count_and_agent_read_only(self):
        self.new_asset()
        rows = {s["key"]: s for s in self.client.get(f"{API}/asset-statuses/").json()}
        self.assertEqual(rows["in_stock"]["asset_count"], 1)
        self.as_user(self.agent)
        self.assertEqual(self.client.get(f"{API}/asset-statuses/").status_code, 200)
        r = self.client.patch(f"{API}/asset-statuses/{self.status['lost'].id}/", {"name": "x"}, format="json")
        self.assertEqual(r.status_code, 403)


class MasterTests(AssetTestCase):
    def test_vendor_crud_unique_and_delete_in_use(self):
        r = self.client.post(f"{API}/asset-vendors/", {"name": "Dell", "email": "sales@dell.test"},
                             format="json")
        self.assertEqual(r.status_code, 201, r.content)
        vid = r.json()["id"]
        self.assertEqual(self.client.post(f"{API}/asset-vendors/", {"name": "dell"}, format="json").status_code, 400)
        self.new_asset(vendor=vid)
        r = self.client.delete(f"{API}/asset-vendors/{vid}/")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Deactivate", str(r.json()))
        r = self.client.patch(f"{API}/asset-vendors/{vid}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200)
        active = self.client.get(f"{API}/asset-vendors/?active=1").json()
        self.assertEqual(active, [])

    def test_existing_inactive_vendor_survives_other_edits(self):
        v = Vendor.objects.create(name="HP")
        a = self.new_asset(vendor=str(v.id)).json()
        v.is_active = False
        v.save()
        r = self.client.patch(f"{API}/assets/{a['id']}/", {"name": "Still HP"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

    def test_location_and_department(self):
        self.assertEqual(self.client.post(f"{API}/asset-locations/", {"name": "Noida", "code": "NOI"},
                                          format="json").status_code, 201)
        self.assertEqual(self.client.post(f"{API}/asset-departments/", {"name": "Finance"},
                                          format="json").status_code, 201)
        self.assertEqual(len(self.client.get(f"{API}/asset-locations/").json()), 1)


class CategoryTests(AssetTestCase):
    def test_two_levels_only_and_unique_names(self):
        r = self.client.post(f"{API}/asset-categories/", {
            "helpdesk": str(self.it.id), "parent": str(self.laptop.id), "name": "Gaming"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f"{API}/asset-categories/", {
            "helpdesk": str(self.it.id), "name": "computer"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f"{API}/asset-categories/", {
            "helpdesk": str(self.it.id), "parent": str(self.computer.id), "name": "Tablet PC"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_db_refuses_duplicate_top_level_names(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            AssetCategory.objects.create(helpdesk=self.it, name="COMPUTER")

    def test_parent_cannot_change(self):
        r = self.client.patch(f"{API}/asset-categories/{self.laptop.id}/", {
            "parent": str(self.server.id)}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_delete_in_use_and_cascade(self):
        self.new_asset()
        self.assertEqual(self.client.delete(f"{API}/asset-categories/{self.computer.id}/").status_code, 400)
        r = self.client.delete(f"{API}/asset-categories/{self.printer.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(AssetCategory.objects.filter(parent=self.printer).exists())  # children soft-deleted
        self.assertFalse(AssetCategoryField.objects.filter(category=self.printer).exists())

    def test_list_scoped_and_hr_cannot_create_in_it(self):
        self.as_user(self.hr_agent)
        self.assertEqual(self.client.get(f"{API}/asset-categories/").json(), [])
        from apps.itsm_rbac.models import SystemRole
        from .base import set_perm
        set_perm(SystemRole.objects.get(code="agent"), "itsm.assets.config",
                 can_read=True, can_create=True, can_update=True)
        r = self.client.post(f"{API}/asset-categories/", {"helpdesk": str(self.it.id), "name": "X"},
                             format="json")
        self.assertEqual(r.status_code, 403)

    def test_categories_show_their_links(self):
        rows = self.client.get(f"{API}/asset-categories/?helpdesk={self.it.id}").json()
        computer = next(c for c in rows if c["name"] == "Computer")
        self.assertIn("serial_number", [link["field_key"] for link in computer["field_links"]])


class FieldTests(AssetTestCase):
    def test_create_dropdown_with_options_and_rules(self):
        r = self.client.post(f"{API}/asset-fields/", {
            "helpdesk": str(self.it.id), "name": "Asset Class", "field_type": "dropdown",
            "options_input": [{"label": "Class A"}, {"label": "Class B"}]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body["key"], "asset_class")
        self.assertEqual([o["value"] for o in body["options"]], ["class_a", "class_b"])
        r = self.client.post(f"{API}/asset-fields/", {
            "helpdesk": str(self.it.id), "name": "asset class", "field_type": "text"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f"{API}/asset-fields/", {
            "helpdesk": str(self.it.id), "name": "Dup", "field_type": "dropdown",
            "options_input": [{"label": "A"}, {"label": "a"}]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_options_relabel_keeps_values(self):
        f = self.field["environment"]
        opts = self.client.get(f"{API}/asset-fields/?helpdesk={self.it.id}").json()
        env = next(x for x in opts if x["key"] == "environment")
        first = env["options"][0]
        r = self.client.patch(f"{API}/asset-fields/{f.id}/", {"options_input": [
            {"id": first["id"], "label": "Prod"}, {"label": "QA"}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        values = {o["label"]: o["value"] for o in r.json()["options"]}
        self.assertEqual(values["Prod"], first["value"])
        self.assertEqual(len(values), 2)

    def test_type_change_refused_once_values_exist(self):
        self.new_asset(details={"serial_number": "SN-1", "hostname": "h1"})
        f = self.field["hostname"]
        r = self.client.patch(f"{API}/asset-fields/{f.id}/", {"field_type": "number"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_delete_field_unlinks_but_keeps_values(self):
        a = self.new_asset(details={"serial_number": "SN-1", "hostname": "h1"}).json()
        f = self.field["hostname"]
        self.assertEqual(self.client.delete(f"{API}/asset-fields/{f.id}/").status_code, 204)
        self.assertFalse(AssetCategoryField.objects.filter(field=f).exists())
        self.assertTrue(AssetFieldValue.objects.filter(asset_id=a["id"], field=f).exists())
        detail = self.client.get(f"{API}/assets/{a['id']}/").json()
        self.assertNotIn("hostname", detail["details"])

    def test_links(self):
        f = AssetField.objects.create(helpdesk=self.it, key="asset_owner", name="Asset Owner",
                                      field_type="text")
        r = self.client.post(f"{API}/asset-category-fields/", {
            "category": str(self.printer.id), "field": str(f.id), "is_required": True}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        r = self.client.post(f"{API}/asset-category-fields/", {
            "category": str(self.printer.id), "field": str(f.id)}, format="json")
        self.assertEqual(r.status_code, 400)
        load_starter(self.hr)
        hr_field = AssetField.objects.get(helpdesk=self.hr, key="model")
        r = self.client.post(f"{API}/asset-category-fields/", {
            "category": str(self.printer.id), "field": str(hr_field.id)}, format="json")
        self.assertEqual(r.status_code, 400)


class StarterTests(AssetTestCase):
    def test_idempotent(self):
        before = (AssetCategory.objects.count(), AssetField.objects.count(), AssetCategoryField.objects.count())
        r = self.client.post(f"{API}/asset-categories/load-starter/", {"helpdesk": str(self.it.id)},
                             format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json(), {"fields": 0, "categories": 0, "links": 0})
        self.assertEqual(before, (AssetCategory.objects.count(), AssetField.objects.count(),
                                  AssetCategoryField.objects.count()))

    def test_agent_cannot_load(self):
        self.as_user(self.agent)
        r = self.client.post(f"{API}/asset-categories/load-starter/", {"helpdesk": str(self.it.id)},
                             format="json")
        self.assertEqual(r.status_code, 403)


class AdminAuditTests(AssetTestCase):
    def test_config_changes_are_audited_asset_edits_are_not(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(f"{API}/asset-vendors/", {"name": "Lenovo"}, format="json")
        with self.captureOnCommitCallbacks(execute=True):
            self.new_asset()
        areas = list(AdminAuditEvent.objects.values_list("area", flat=True))
        self.assertIn("itsm.assets.config", areas)
        self.assertNotIn("itsm.assets", areas)
