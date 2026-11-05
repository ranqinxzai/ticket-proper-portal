"""Asset documents: upload, list, download, remove, history, file rules, RBAC, scope."""

from __future__ import annotations

import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.itsm_rbac.models import SystemRole

from ..models import AssetDocument, AssetEvent
from ..services import documents as document_service
from .base import API, AssetTestCase, make_user, set_perm

PDF = b"%PDF-1.4\n% test invoice\n"


def upload(name="invoice-0042.pdf", data=PDF, content_type="application/pdf"):
    return SimpleUploadedFile(name, data, content_type=content_type)


# MEDIA_ROOT in a temp dir: the test harness mounts the source read-only.
@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class AssetDocumentTests(AssetTestCase):
    def setUp(self):
        super().setUp()
        self.asset = self.new_asset().json()
        self.url = f"{API}/assets/{self.asset['id']}/documents/"

    def add(self, doc_type="invoice", file=None, note=""):
        return self.client.post(self.url, {"doc_type": doc_type, "note": note,
                                           "file": file or upload()}, format="multipart")

    def test_upload_list_download_and_history(self):
        r = self.add(note="PO 7781")
        self.assertEqual(r.status_code, 201, r.content)
        doc = r.json()
        self.assertEqual(doc["doc_type_label"], "Invoice")
        self.assertEqual(doc["original_name"], "invoice-0042.pdf")
        self.assertEqual(doc["size_bytes"], len(PDF))
        self.assertEqual(doc["note"], "PO 7781")
        self.assertEqual(doc["uploaded_by"]["full_name"], "Ada Admin")
        self.assertNotIn("file", doc)  # no public URL is ever exposed

        stored = AssetDocument.objects.get(pk=doc["id"])
        self.assertTrue(stored.file.name.startswith(f"itsm_private/asset_documents/{self.asset['id']}/"))
        self.assertNotIn("invoice-0042", stored.file.name)  # random name on disk

        # Listed Invoice → Warranty card → Manual → Other.
        self.add("other", upload("notes.txt", b"hello", "text/plain"))
        self.add("warranty", upload("card.JPG", b"\xff\xd8\xff", "image/jpeg"))
        r = self.client.get(self.url)
        self.assertEqual([d["doc_type"] for d in r.json()], ["invoice", "warranty", "other"])

        r = self.client.get(f"{self.url}{doc['id']}/download/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(b"".join(r.streaming_content), PDF)
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")
        self.assertIn('attachment; filename="invoice-0042.pdf"', r["Content-Disposition"])

        added = AssetEvent.objects.filter(asset_id=self.asset["id"], action="document_added")
        self.assertEqual(added.count(), 3)
        self.assertIn("Invoice · invoice-0042.pdf", added.values_list("note", flat=True))

    def test_content_type_comes_from_the_extension(self):
        r = self.add("warranty", upload("card.png", b"\x89PNG", "text/html"))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["content_type"], "image/png")

    def test_remove_soft_deletes_logs_and_hides(self):
        doc = self.add().json()
        r = self.client.delete(f"{self.url}{doc['id']}/")
        self.assertEqual(r.status_code, 204)
        row = AssetDocument.all_objects.get(pk=doc["id"])
        self.assertTrue(row.is_deleted)
        self.assertEqual(row.deleted_by, self.admin)
        self.assertEqual(self.client.get(self.url).json(), [])
        self.assertEqual(self.client.get(f"{self.url}{doc['id']}/download/").status_code, 404)
        self.assertEqual(self.client.delete(f"{self.url}{doc['id']}/").status_code, 404)
        ev = AssetEvent.objects.get(asset_id=self.asset["id"], action="document_removed")
        self.assertEqual(ev.note, "Invoice · invoice-0042.pdf")
        self.assertEqual(ev.get_action_display(), "Document removed")

    def test_file_rules(self):
        for name in ("page.html", "logo.svg", "tool.exe", "bundle.zip", "noext"):
            r = self.add("other", upload(name, b"x", "application/octet-stream"))
            self.assertEqual(r.status_code, 400, name)
            self.assertIn("file", r.json()["errors"])
        self.assertIn("file", self.add(file=upload(data=b"")).json()["errors"])
        r = self.client.post(self.url, {"doc_type": "invoice"}, format="multipart")
        self.assertIn("file", r.json()["errors"])
        self.assertIn("doc_type", self.add(doc_type="receipt").json()["errors"])
        self.assertIn("note", self.add(note="x" * 256).json()["errors"])
        self.assertEqual(AssetDocument.objects.count(), 0)
        self.assertFalse(AssetEvent.objects.filter(action="document_added").exists())

    def test_size_limit(self):
        with mock.patch.object(document_service, "MAX_BYTES", 10):
            r = self.add(file=upload(data=b"x" * 11))
        self.assertEqual(r.status_code, 400)
        self.assertIn("larger than", r.json()["errors"]["file"][0])

    def test_agent_can_upload_and_remove(self):
        self.as_user(self.agent)
        r = self.add()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.client.delete(f"{self.url}{r.json()['id']}/").status_code, 204)

    def test_read_only_role_can_list_and_download_only(self):
        doc = self.add().json()
        role = SystemRole.objects.create(code="assetviewer", name="Asset viewer")
        set_perm(role, "itsm.assets", can_read=True)
        self.as_user(make_user("viewer", "assetviewer", self.it))
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.get(f"{self.url}{doc['id']}/download/").status_code, 200)
        self.assertEqual(self.add().status_code, 403)
        self.assertEqual(self.client.delete(f"{self.url}{doc['id']}/").status_code, 403)

    def test_create_and_delete_bits_alone_are_not_enough(self):
        # Adding / removing is an edit of the asset: it needs update, not create/delete.
        role = SystemRole.objects.create(code="assetadder", name="Asset adder")
        set_perm(role, "itsm.assets", can_read=True, can_create=True, can_delete=True)
        self.as_user(make_user("adder", "assetadder", self.it))
        self.assertEqual(self.add().status_code, 403)

    def test_requestor_and_other_helpdesk(self):
        doc = self.add().json()
        self.as_user(self.requestor)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.get(f"{self.url}{doc['id']}/download/").status_code, 403)
        self.as_user(self.hr_agent)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.get(f"{self.url}{doc['id']}/download/").status_code, 404)
        self.assertEqual(self.add().status_code, 404)

    def test_document_of_another_asset_is_404(self):
        doc = self.add().json()
        other = self.new_asset(name="Spare", details={"serial_number": "SN-2"}).json()
        r = self.client.get(f"{API}/assets/{other['id']}/documents/{doc['id']}/download/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.client.delete(f"{API}/assets/{other['id']}/documents/{doc['id']}/").status_code, 404)
