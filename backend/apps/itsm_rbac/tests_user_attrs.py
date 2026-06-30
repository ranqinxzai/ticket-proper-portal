"""Custom user attributes: definition CRUD, create-user with attributes,
required validation, edit (set_attributes), roster column hydration, filtering."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_rbac.registry import seed_rbac

from .models import (
    UserAttributeDefinition,
    UserAttributeOption,
    UserAttributeValue,
)
from . import user_attr_service

User = get_user_model()

ATTRS = "/api/v1/itsm/user-attributes/"
OPTS = "/api/v1/itsm/user-attribute-options/"
MEMBERS = "/api/v1/itsm/members/"


def _rows(resp):
    data = resp.json()
    return data["results"] if isinstance(data, dict) and "results" in data else data


def _make_attr(**kw):
    kw.setdefault("name", "Department")
    kw.setdefault("key", "department")
    kw.setdefault("attr_type", "text")
    return UserAttributeDefinition.objects.create(**kw)


class UserAttributeApiTests(TestCase):
    def setUp(self):
        seed_rbac()
        self.admin = User.objects.create_superuser(username="adm", password="x", email="a@a.io")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    # --- definition + option CRUD ---------------------------------------
    def test_create_dropdown_attribute_with_options(self):
        resp = self.client.post(
            ATTRS,
            {"name": "Location", "key": "Location", "attr_type": "dropdown"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        # key is normalised to a slug
        self.assertEqual(resp.json()["key"], "location")
        attr_id = resp.json()["id"]
        opt = self.client.post(
            OPTS, {"attribute": attr_id, "value": "hq", "label": "HQ"}, format="json"
        )
        self.assertEqual(opt.status_code, 201, opt.content)
        detail = self.client.get(f"{ATTRS}{attr_id}/").json()
        self.assertEqual([o["value"] for o in detail["options"]], ["hq"])

    def test_delete_is_soft(self):
        attr = _make_attr()
        resp = self.client.delete(f"{ATTRS}{attr.id}/")
        self.assertEqual(resp.status_code, 204)
        attr.refresh_from_db()
        self.assertTrue(attr.is_deleted)
        self.assertNotIn(str(attr.id), [str(a["id"]) for a in _rows(self.client.get(ATTRS))])

    # --- create user with attributes ------------------------------------
    def test_create_user_sets_attributes(self):
        _make_attr(key="department", name="Department", attr_type="text")
        _make_attr(key="seats", name="Seats", attr_type="number")
        resp = self.client.post(
            f"{MEMBERS}create_user/",
            {
                "username": "neo",
                "full_name": "Neo",
                "attributes": {"department": "Platform", "seats": 3},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["attributes"], {"department": "Platform", "seats": 3.0})
        user = User.objects.get(username="neo")
        self.assertEqual(user_attr_service.get_values(user), {"department": "Platform", "seats": 3.0})

    def test_required_attribute_blocks_create(self):
        _make_attr(key="department", name="Department", attr_type="text", is_required=True)
        resp = self.client.post(
            f"{MEMBERS}create_user/",
            {"username": "trinity", "attributes": {}},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("department", resp.json()["attributes"])
        self.assertFalse(User.objects.filter(username="trinity").exists())

    def test_required_dropdown_without_options_does_not_block(self):
        # An unconfigured required dropdown can't be satisfied → must not deadlock.
        _make_attr(key="team", name="Team", attr_type="dropdown", is_required=True)
        resp = self.client.post(
            f"{MEMBERS}create_user/", {"username": "morpheus"}, format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    # --- multiselect round-trips a list ---------------------------------
    def test_multiselect_round_trip(self):
        attr = _make_attr(key="skills", name="Skills", attr_type="multiselect")
        for v in ("python", "react", "sql"):
            UserAttributeOption.objects.create(attribute=attr, value=v, label=v.title())
        resp = self.client.post(
            f"{MEMBERS}create_user/",
            {"username": "tank", "attributes": {"skills": ["python", "sql"]}},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["attributes"]["skills"], ["python", "sql"])

    # --- edit existing user's attributes --------------------------------
    def test_set_attributes_edits_existing_user(self):
        _make_attr(key="department", name="Department", attr_type="text")
        user = User.objects.create_user(username="cypher")
        resp = self.client.post(
            f"{MEMBERS}{user.pk}/set_attributes/",
            {"attributes": {"department": "Ops"}},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["attributes"], {"department": "Ops"})
        # clearing sends empty string → attribute reads back empty
        resp2 = self.client.post(
            f"{MEMBERS}{user.pk}/set_attributes/",
            {"attributes": {"department": ""}},
            format="json",
        )
        self.assertEqual(resp2.json()["attributes"], {"department": ""})

    def test_set_attributes_rejects_clearing_required(self):
        _make_attr(key="department", name="Department", attr_type="text", is_required=True)
        user = User.objects.create_user(username="switch")
        resp = self.client.post(
            f"{MEMBERS}{user.pk}/set_attributes/",
            {"attributes": {"department": ""}},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    # --- roster filtering + filter-fields -------------------------------
    def test_roster_filter_by_attribute(self):
        attr = _make_attr(key="department", name="Department", attr_type="text")
        a = User.objects.create_user(username="a-eng")
        b = User.objects.create_user(username="b-sales")
        user_attr_service.set_values(a, {"department": "Engineering"})
        user_attr_service.set_values(b, {"department": "Sales"})
        rows = self.client.get(f"{MEMBERS}?attr_department=engineering").json()
        rows = rows["results"] if isinstance(rows, dict) and "results" in rows else rows
        usernames = {r["username"] for r in rows}
        self.assertIn("a-eng", usernames)
        self.assertNotIn("b-sales", usernames)

    def test_filter_fields_lists_active_attrs_with_options(self):
        attr = _make_attr(key="location", name="Location", attr_type="dropdown")
        UserAttributeOption.objects.create(attribute=attr, value="hq", label="HQ")
        _make_attr(key="inactive_one", name="Inactive", attr_type="text", is_active=False)
        fields = self.client.get(f"{MEMBERS}filter_fields/").json()
        keys = {f["key"] for f in fields}
        self.assertIn("location", keys)
        self.assertNotIn("inactive_one", keys)
        loc = next(f for f in fields if f["key"] == "location")
        self.assertEqual([o["value"] for o in loc["options"]], ["hq"])

    # --- permission gating ----------------------------------------------
    def test_non_admin_cannot_manage_attributes(self):
        plain = User.objects.create_user(username="plain")
        c = APIClient()
        c.force_authenticate(plain)
        self.assertEqual(c.post(ATTRS, {"name": "X", "key": "x", "attr_type": "text"},
                                format="json").status_code, 403)
