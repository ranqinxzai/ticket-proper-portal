"""B20: saved queue-column layouts keep hidden columns' order (`!`-prefixed
entries) and old visible-only lists round-trip unchanged."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_core.models import FieldDefinition
from apps.itsm_dashboards.models import QueueColumnPreference
from apps.itsm_tickets.services.filter_fields import clean_queue_columns
from apps.itsm_tickets.tests import _project, _seed_min

User = get_user_model()


class CleanQueueColumnsTests(TestCase):
    def test_old_visible_only_list_unchanged(self):
        old = ["ticket_number", "summary", "status", "cf:type"]
        self.assertEqual(clean_queue_columns(old), old)

    def test_hidden_entries_keep_their_place(self):
        value = ["ticket_number", "!created_by", "summary", "!cf:type", "status"]
        self.assertEqual(clean_queue_columns(value), value)

    def test_drops_bogus_stale_and_duplicates(self):
        value = ["summary", "!bogus", "!summary", "!cf:gone", "cf:live", "!!status", 7]
        self.assertEqual(
            clean_queue_columns(value, valid_cf={"cf:live"}), ["summary", "cf:live"])

    def test_hidden_only_is_empty(self):
        self.assertEqual(clean_queue_columns(["!summary", "!status"]), [])


class QueueColumnLayoutApiTests(TestCase):
    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "service_request")
        FieldDefinition.objects.create(project=self.proj, key="type", name="Type", field_type="text")
        self.root = User.objects.create_superuser(username="root7", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)

    def test_project_layout_round_trip(self):
        url = reverse("itsm-project-detail", args=[self.proj.id])
        # cf:impact is ITIL but Incident/Problem-only, cf:description is column-backed
        # with no cell, cf:nope unknown → dropped. cf:resolution_notes is a
        # column-backed ITIL field that applies to requests → kept.
        layout = ["ticket_number", "summary", "!priority", "status", "!cf:type",
                  "!cf:impact", "!cf:nope", "cf:description", "cf:resolution_notes"]
        resp = self.client.patch(url, {"queue_columns": layout}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.proj.refresh_from_db()
        self.assertEqual(self.proj.queue_columns,
                         ["ticket_number", "summary", "!priority", "status", "!cf:type",
                          "cf:resolution_notes"])
        # Old visible-only lists still save exactly as before.
        resp = self.client.patch(url, {"queue_columns": ["summary", "cf:type"]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.proj.refresh_from_db()
        self.assertEqual(self.proj.queue_columns, ["summary", "cf:type"])

    def test_helpdesk_layout_round_trip(self):
        hd = self.proj.helpdesk
        resp = self.client.patch(reverse("itsm-helpdesk-detail", args=[hd.id]),
                                 {"combined_queue_columns": ["project", "summary", "!status", "!x"]},
                                 format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        hd.refresh_from_db()
        self.assertEqual(hd.combined_queue_columns, ["project", "summary", "!status"])

    def test_personal_pref_validated(self):
        resp = self.client.post(reverse("itsm-queue-columns-list"),
                                {"project": str(self.proj.id),
                                 "columns": ["summary", "!status", "junk"]}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        pref = QueueColumnPreference.objects.get(owner=self.root, project=self.proj)
        self.assertEqual(pref.columns, ["summary", "!status"])
