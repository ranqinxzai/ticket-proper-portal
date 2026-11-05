"""Field engine: required-field validation vs visibility rules (B5), rule/section
validation on the layout API (B21/B22) and cascade-node delete (C5)."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_core.models import FieldDefinition, FieldLayout, FieldLayoutItem, FieldOption
from apps.itsm_core.services import fields as field_service
from apps.itsm_tickets.tests import _project, _seed_min

User = get_user_model()


class VisibilityStateTests(TestCase):
    """`visibility_state` mirrors the forms' normRule + evalRule."""

    def test_multiselect_value_matches_when_list_includes_target(self):
        # N21: "is X" on a multiselect = the picked list includes X; empty list = no value.
        show = {"field": "tags", "operator": "eq", "value": "vpn", "action": "show"}
        hide = {**show, "operator": "neq"}
        self.assertEqual(field_service.visibility_state(show, {"tags": ["vpn", "wifi"]}), (True, False))
        self.assertEqual(field_service.visibility_state(show, {"tags": ["wifi"]}), (False, False))
        self.assertEqual(field_service.visibility_state(show, {"tags": []}), (False, False))
        self.assertEqual(field_service.visibility_state(hide, {"tags": []}), (False, False))
        self.assertEqual(field_service.visibility_state(hide, {"tags": ["wifi"]}), (True, False))
        # an older rule typed as the joined string still matches exactly
        legacy = {**show, "value": "vpn,wifi"}
        self.assertEqual(field_service.visibility_state(legacy, {"tags": ["vpn", "wifi"]}), (True, False))

    def test_no_rule(self):
        self.assertEqual(field_service.visibility_state(None, {}), (True, False))

    def test_show_rule_on_absent_status_never_matches(self):
        rule = {"action": "show", "field": "status", "operator": "eq", "value": "on_hold"}
        self.assertEqual(field_service.visibility_state(rule, {}), (False, False))

    def test_neq_needs_a_value(self):
        rule = {"action": "show", "field": "kind", "operator": "neq", "value": "a"}
        self.assertEqual(field_service.visibility_state(rule, {}), (False, False))
        self.assertEqual(field_service.visibility_state(rule, {"kind": "b"}), (True, False))
        self.assertEqual(field_service.visibility_state(rule, {"kind": "a"}), (False, False))

    def test_readonly_and_js_string_compare(self):
        rule = {"action": "readonly", "field": "vip", "operator": "eq", "value": "true"}
        self.assertEqual(field_service.visibility_state(rule, {"vip": True}), (True, True))
        self.assertEqual(field_service.visibility_state(rule, {"vip": False}), (True, False))

    def test_legacy_equals_shape(self):
        rule = {"field": "kind", "equals": "a"}
        self.assertEqual(field_service.visibility_state(rule, {"kind": "a"}), (True, False))


class ValidateRequiredTests(TestCase):
    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "service_request")
        self.layout = FieldLayout.objects.get(project=self.proj, ticket_type__isnull=True)
        self.kind = FieldDefinition.objects.create(
            project=self.proj, key="kind", name="Kind", field_type="text")
        self.detail = FieldDefinition.objects.create(
            project=self.proj, key="detail", name="Detail", field_type="text")

    def _item(self, field, **kw):
        kw.setdefault("is_mandatory", True)
        return FieldLayoutItem.objects.create(layout=self.layout, field=field, sort_order=900, **kw)

    def _errors(self, values, **kw):
        return field_service.validate_required(self.proj, None, values, **kw)

    def test_plain_required_field(self):
        self._item(self.detail)
        self.assertIn("detail", self._errors({}))
        self.assertEqual(self._errors({})["detail"], ["Detail is required."])
        self.assertNotIn("detail", self._errors({"detail": "x"}))
        self.assertIn("detail", self._errors({"detail": "   "}))  # whitespace = blank

    def test_rule_hidden_field_is_not_required(self):
        self._item(self.detail, visibility_rule={
            "action": "show", "field": "kind", "operator": "eq", "value": "hardware"})
        self.assertNotIn("detail", self._errors({"kind": "software"}))
        self.assertNotIn("detail", self._errors({}))
        self.assertIn("detail", self._errors({"kind": "hardware"}))

    def test_status_rule_never_matches_at_create(self):
        self._item(self.detail, visibility_rule={
            "action": "show", "field": "status", "operator": "eq", "value": "on_hold"})
        self.assertNotIn("detail", self._errors({}))

    def test_readonly_by_rule_is_not_required(self):
        self._item(self.detail, visibility_rule={
            "action": "readonly", "field": "kind", "operator": "eq", "value": "locked"})
        self.assertNotIn("detail", self._errors({"kind": "locked"}))
        self.assertIn("detail", self._errors({"kind": "open"}))

    def test_attachment_never_required(self):
        att = FieldDefinition.objects.create(
            project=self.proj, key="evidence", name="Evidence", field_type="attachment")
        self._item(att)
        self.assertNotIn("evidence", self._errors({}))

    def test_deleted_field_is_skipped(self):
        self._item(self.detail)
        self.detail.soft_delete()
        self.assertNotIn("detail", self._errors({}))

    def test_cascade_with_only_orphan_nodes_is_skipped(self):
        cat = FieldDefinition.objects.create(
            project=self.proj, key="area", name="Area", field_type="cascade")
        top = FieldOption.objects.create(field=cat, value="hw", label="Hardware", level=1)
        FieldOption.objects.create(field=cat, value="hw__laptop", label="Laptop", level=2, parent=top)
        self._item(cat)
        self.assertIn("area", self._errors({}))
        top.soft_delete()  # child stays live but is unreachable
        self.assertNotIn("area", self._errors({}))

    def test_hidden_or_portal_off(self):
        self._item(self.detail, is_hidden=True)
        self.assertNotIn("detail", self._errors({}))
        FieldLayoutItem.objects.filter(field=self.detail).update(is_hidden=False, portal_visible=False)
        self.assertIn("detail", self._errors({}))
        self.assertNotIn("detail", self._errors({}, portal_only=True))

    def test_columns_fill_column_backed_fields(self):
        # Seeded Description (key `description`, maps_to `description_html`) is Required.
        self.assertIn("description", self._errors({}))
        self.assertNotIn("description", self._errors({}, columns={"description_html": "<p>x</p>"}))
        self.assertIn("description", self._errors({}, columns={"description_html": ""}))


class LayoutApiValidationTests(TestCase):
    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "service_request")
        self.layout = FieldLayout.objects.get(project=self.proj, ticket_type__isnull=True)
        self.item = self.layout.items.first()
        root = User.objects.create_superuser(username="root4", password="x")
        self.client = APIClient()
        self.client.force_authenticate(root)

    def _patch_rule(self, rule):
        return self.client.patch(
            reverse("itsm-field-layout-item-detail", args=[self.item.id]),
            {"visibility_rule": rule}, format="json")

    def test_empty_rule_value_rejected(self):
        resp = self._patch_rule({"action": "show", "field": "status", "operator": "eq", "value": " "})
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("visibility_rule", resp.json())

    def test_valid_rule_saved_and_null_clears(self):
        resp = self._patch_rule({"action": "show", "field": "status", "operator": "eq", "value": "on_hold"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.item.refresh_from_db()
        self.assertEqual(self.item.visibility_rule["value"], "on_hold")
        resp = self._patch_rule(None)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.item.refresh_from_db()
        self.assertIsNone(self.item.visibility_rule)

    def test_sections_persist_and_validate(self):
        url = reverse("itsm-field-layout-detail", args=[self.layout.id])
        resp = self.client.patch(url, {"sections": [
            {"region": "main", "name": " Hardware "},
            {"region": "main", "name": "Hardware"},
            {"region": "sidebar", "name": "Extra"},
        ]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["sections"], [
            {"region": "main", "name": "Hardware"}, {"region": "sidebar", "name": "Extra"}])
        self.layout.refresh_from_db()
        self.assertEqual(len(self.layout.sections), 2)
        bad = self.client.patch(url, {"sections": [{"region": "top", "name": "X"}]}, format="json")
        self.assertEqual(bad.status_code, 400)
        bad = self.client.patch(url, {"sections": [{"region": "main", "name": "x" * 81}]}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_section_collapsed_flag_persists_and_resolves(self):
        url = reverse("itsm-field-layout-detail", args=[self.layout.id])
        resp = self.client.patch(url, {"sections": [
            {"region": "sidebar", "name": "People", "collapsed": True},
            {"region": "main", "name": "Hardware", "collapsed": False},
        ]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        # Kept only when true, so an un-collapsed entry has the old two-key shape.
        self.assertEqual(resp.json()["sections"], [
            {"region": "sidebar", "name": "People", "collapsed": True},
            {"region": "main", "name": "Hardware"}])
        resolved = self.client.get(reverse("itsm-field-layout-resolve"), {"project": str(self.proj.id)})
        self.assertEqual(resolved.status_code, 200, resolved.content)
        self.assertIn({"region": "sidebar", "name": "People", "collapsed": True}, resolved.json()["sections"])
        bad = self.client.patch(url, {"sections": [
            {"region": "main", "name": "X", "collapsed": "yes"}]}, format="json")
        self.assertEqual(bad.status_code, 400)


class CascadeNodeDeleteTests(TestCase):
    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "service_request")
        self.cat = FieldDefinition.objects.create(
            project=self.proj, key="area", name="Area", field_type="cascade")
        self.top = FieldOption.objects.create(field=self.cat, value="hw", label="HW", level=1)
        self.mid = FieldOption.objects.create(field=self.cat, value="hw__pc", label="PC", level=2, parent=self.top)
        self.leaf = FieldOption.objects.create(field=self.cat, value="hw__pc__fan", label="Fan", level=3, parent=self.mid)
        self.other = FieldOption.objects.create(field=self.cat, value="sw", label="SW", level=1)
        root = User.objects.create_superuser(username="root5", password="x")
        self.client = APIClient()
        self.client.force_authenticate(root)

    def test_delete_node_removes_descendants_only(self):
        resp = self.client.delete(reverse("itsm-field-option-detail", args=[self.top.id]))
        self.assertEqual(resp.status_code, 204, resp.content)
        live = set(FieldOption.objects.filter(field=self.cat).values_list("value", flat=True))
        self.assertEqual(live, {"sw"})
        self.assertTrue(FieldOption.all_objects.get(pk=self.leaf.pk).is_deleted)
