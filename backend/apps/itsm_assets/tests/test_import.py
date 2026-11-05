"""Excel import: template, good rows saved / bad rows kept, dry run, masters, files."""

from __future__ import annotations

import datetime as dt
import io
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.itsm_rbac.models import SystemRole

from ..models import Asset, AssetEvent, AssetImport, AssetImportRow, Department, Vendor
from ..services.parsing import org_today
from .base import API, AssetTestCase, set_perm, xlsx_upload

HEADERS = ["Asset Name *", "Asset Tag", "Category *", "Sub-category", "Status", "Vendor",
           "Location", "User", "Department", "Allotment Notes", "Purchase Date", "Purchase Cost",
           "Expiry Date", "Warranty Expiry Date", "Serial Number", "RAM (GB)", "Operating System",
           "Hostname", "IP Address"]


def row(**kw):
    order = ["name", "tag", "category", "sub", "status", "vendor", "location", "user", "dept",
             "notes", "purchased", "cost", "expiry", "warranty", "serial", "ram", "os", "host", "ip"]
    return [kw.get(k) for k in order]


class ImportTests(AssetTestCase):
    def setUp(self):
        super().setUp()
        self.past = org_today() - dt.timedelta(days=30)
        Vendor.objects.create(name="Dell")
        self.client.post(f"{API}/assets/", {
            "helpdesk": str(self.it.id), "name": "Existing", "asset_tag": "EXIST-1",
            "category": str(self.computer.id), "details": {"serial_number": "E1"}}, format="json")

    def _mixed_file(self):
        rows = [
            row(name="Good laptop", category="Computer", sub="laptop", serial="S1", ram=16,
                os="Windows 11", vendor="dell", purchased=dt.datetime(2026, 1, 5), cost="45,000.50",
                warranty="31-12-2027"),                                                     # 2 ok
            row(name="Bad cat", category="Spaceship", serial="S2"),                          # 3
            row(name="Dup DB", tag="exist-1", category="Computer", serial="S3"),             # 4
            row(name="Tag A", tag="T-100", category="Computer", serial="S4"),                # 5 ok
            row(name="Tag A again", tag="t-100", category="Computer", serial="S5"),          # 6
            row(name="Bad date", category="Computer", serial="S6", purchased="2026-13-45"),  # 7
            row(name="No serial", category="Computer"),                                      # 8
            row(name="Not applicable", category="Printer", serial="S8", ram=8),             # 9
            row(name="In use nobody", category="Computer", serial="S9", status="In Use"),   # 10
            row(name="In use by email", category="Computer", serial="S10", status="in use",
                user="ANN@x.test"),                                                          # 11 ok
            row(name="Old one", category="Computer", serial="S11", expiry=self.past),        # 12 ok → Expired
            row(name="Old explicit", category="Computer", serial="S12", expiry=self.past,
                status="In Stock"),                                                          # 13
            row(name="Server ok", category="Server", sub="Virtual Machine", os="Ubuntu",
                host="vm-1", ip="10.0.0.5"),                                                 # 14 ok
            row(name="Unknown vendor", category="Computer", serial="S14", vendor="Acme"),    # 15
            [None] * len(HEADERS),                                                           # blank skipped
            row(name="=cmd|' /C calc'!A0", category="Bogus"),                                # 17
        ]
        return xlsx_upload(rows, HEADERS)

    def _post(self, upload, path="", **extra):
        data = {"helpdesk": str(self.it.id), "file": upload, **extra}
        return self.client.post(f"{API}/asset-imports/{path}", data, format="multipart")

    def test_mixed_file_saves_good_rows_and_keeps_failed_rows(self):
        r = self._post(self._mixed_file())
        self.assertEqual(r.status_code, 201, r.content)
        res = r.json()
        self.assertEqual(res["total_rows"], 15)
        self.assertEqual(res["valid_rows"], 5)
        self.assertEqual(res["failed_count"], 10)
        self.assertEqual(res["expired_count"], 1)
        failed = {f["row_number"]: f for f in res["failed_rows"]}
        self.assertEqual(sorted(failed), [3, 4, 6, 7, 8, 9, 10, 13, 15, 17])

        def msgs(n):
            return " | ".join(f"{e['column']}: {e['message']}" for e in failed[n]["errors"])

        self.assertIn("Category: “Spaceship” isn't a category", msgs(3))
        self.assertIn("already used by another asset", msgs(4))
        self.assertIn("appears more than once in this file (row 5)", msgs(6))
        self.assertIn("Purchase Date", msgs(7))
        self.assertIn("Serial Number: This field is required.", msgs(8))
        self.assertIn("RAM (GB): This field doesn't apply to Printer", msgs(9))
        self.assertIn("needs a User or a Department", msgs(10))
        self.assertIn("expiry date", msgs(13))
        self.assertIn("isn't in the Vendors list", msgs(15))

        run = AssetImport.objects.get(pk=res["import_id"])
        self.assertEqual((run.created_count, run.failed_count), (5, 10))
        self.assertEqual(run.rows.count(), 10)
        good = Asset.objects.get(name="Good laptop")
        self.assertEqual(good.source_import_id, run.id)
        self.assertEqual(good.vendor.name, "Dell")
        self.assertEqual(good.sub_category, self.laptop)
        self.assertEqual(str(good.purchase_cost), "45000.50")
        self.assertEqual(good.purchase_date, dt.date(2026, 1, 5))
        self.assertEqual(good.warranty_expiry_date, dt.date(2027, 12, 31))
        self.assertTrue(good.asset_tag.startswith("IT-AST-"))
        self.assertEqual(Asset.objects.get(name="In use by email").assigned_user, self.agent)
        self.assertEqual(Asset.objects.get(name="Old one").status.key, "expired")
        ev = AssetEvent.objects.get(asset=good)
        self.assertEqual(ev.action, "imported")
        self.assertIn("Row 2 of assets.xlsx", ev.note)
        # The import list filter finds exactly the imported assets.
        listed = self.client.get(f"{API}/assets/?import={run.id}").json()
        self.assertEqual(listed["count"], 5)

    def test_dry_run_saves_nothing(self):
        before = (Asset.objects.count(), AssetImport.objects.count())
        r = self._post(self._mixed_file(), "validate/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["dry_run"])
        self.assertEqual(r.json()["valid_rows"], 5)
        self.assertEqual(before, (Asset.objects.count(), AssetImport.objects.count()))

    def test_failed_rows_workbook_round_trip(self):
        res = self._post(self._mixed_file()).json()
        r = self.client.get(f"{API}/asset-imports/{res['import_id']}/failed-rows/")
        self.assertEqual(r.status_code, 200)
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        ws = wb["Assets"]
        headers = [c.value for c in ws[1]]
        self.assertEqual(headers[-1], "Errors")
        names = [ws.cell(row=i, column=1).value for i in range(2, ws.max_row + 1)]
        self.assertIn("Bad cat", names)
        evil = next(ws.cell(row=i, column=1) for i in range(2, ws.max_row + 1)
                    if str(ws.cell(row=i, column=1).value).startswith("=cmd"))
        self.assertTrue(evil.quotePrefix)
        # Fix row "Bad cat" in the downloaded file and upload it again.
        for i in range(ws.max_row, 1, -1):
            if ws.cell(row=i, column=1).value != "Bad cat":
                ws.delete_rows(i)
        self.assertEqual(ws.cell(row=2, column=1).value, "Bad cat")
        ws.cell(row=2, column=3).value = "Monitor"
        buf = io.BytesIO()
        wb.save(buf)
        upload = SimpleUploadedFile("fixed.xlsx", buf.getvalue())
        r = self._post(upload)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["failed_count"], 0, r.json())
        self.assertTrue(Asset.objects.filter(name="Bad cat", category__name="Monitor").exists())

    def test_rows_endpoint_and_history_list(self):
        res = self._post(self._mixed_file()).json()
        rows = self.client.get(f"{API}/asset-imports/{res['import_id']}/rows/?page_size=3").json()
        self.assertEqual(rows["count"], 10)
        self.assertEqual(len(rows["results"]), 3)
        hist = self.client.get(f"{API}/asset-imports/").json()
        self.assertEqual(hist["results"][0]["created_count"], 5)

    def test_create_missing_masters(self):
        upload = xlsx_upload([row(name="X1", category="Computer", serial="1", vendor="Acme",
                                  dept="Finance", status="In Use")], HEADERS)
        r = self._post(upload, create_missing="1")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["will_create"], {"vendors": ["Acme"], "departments": ["Finance"]})
        a = Asset.objects.get(name="X1")
        self.assertEqual((a.vendor.name, a.department.name), ("Acme", "Finance"))
        self.assertEqual(Department.objects.filter(name="Finance").count(), 1)

    def test_create_missing_needs_config_create(self):
        agent_role = SystemRole.objects.get(code="agent")
        set_perm(agent_role, "itsm.assets.import", can_read=True, can_create=True)
        self.as_user(self.agent)
        upload = xlsx_upload([row(name="X1", category="Computer", serial="1")], HEADERS)
        r = self._post(upload, create_missing="1")
        self.assertEqual(r.status_code, 403)
        upload = xlsx_upload([row(name="X1", category="Computer", serial="1")], HEADERS)
        self.assertEqual(self._post(upload).status_code, 201)

    def test_agent_without_import_permission(self):
        self.as_user(self.agent)
        upload = xlsx_upload([row(name="X1", category="Computer", serial="1")], HEADERS)
        self.assertEqual(self._post(upload).status_code, 403)
        self.assertEqual(self.client.get(f"{API}/asset-imports/template/?helpdesk={self.it.id}").status_code, 403)

    def test_other_helpdesk_import_refused(self):
        self.as_user(self.hr_agent)
        set_perm(SystemRole.objects.get(code="agent"), "itsm.assets.import", can_read=True, can_create=True)
        upload = xlsx_upload([row(name="X1", category="Computer", serial="1")], HEADERS)
        self.assertEqual(self._post(upload).status_code, 403)

    def test_file_errors(self):
        r = self._post(SimpleUploadedFile("a.xlsx", b"not a zip"))
        self.assertEqual(r.status_code, 400)
        self.assertIn("isn't an Excel", r.json()["detail"])
        r = self._post(xlsx_upload([["x"]], ["Asset Name"]))
        self.assertEqual(r.status_code, 400)
        self.assertIn("no Category column", r.json()["detail"])
        r = self.client.post(f"{API}/asset-imports/", {"helpdesk": str(self.it.id)}, format="multipart")
        self.assertEqual(r.status_code, 400)
        with mock.patch("apps.itsm_assets.services.importer.MAX_ROWS", 2):
            upload = xlsx_upload([row(name=f"A{i}", category="Computer", serial=str(i)) for i in range(3)],
                                 HEADERS)
            r = self._post(upload)
        self.assertEqual(r.status_code, 400)
        self.assertIn("more than 2 asset rows", r.json()["detail"])

    def test_unknown_columns_are_warned_and_errors_column_ignored(self):
        upload = xlsx_upload([row(name="W1", category="Computer", serial="1") + ["x", "y"]],
                             HEADERS + ["Colour", "Errors"])
        r = self._post(upload)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["warnings"], ["Column “Colour” isn't recognised, so it was ignored."])

    def test_template(self):
        r = self.client.get(f"{API}/asset-imports/template/?helpdesk={self.it.id}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("asset-import-template-IT.xlsx", r["Content-Disposition"])
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        self.assertEqual(wb.sheetnames, ["Instructions", "Assets", "Lists", "Fields by category"])
        headers = [c.value for c in wb["Assets"][1]]
        self.assertEqual(headers[:3], ["Asset Name *", "Asset Tag", "Category *"])
        self.assertIn("Service Tag", headers)
        lists = wb["Lists"]
        self.assertEqual(lists["A1"].value, "Categories")
        self.assertIn("Computer", [c.value for c in lists["A"]])
        self.assertTrue(wb["Assets"].data_validations.dataValidation)
        # A template uploaded unchanged has no rows → nothing to import.
        r = self._post(SimpleUploadedFile("t.xlsx", r.content))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["total_rows"], 0)

    def test_failed_rows_are_persisted(self):
        res = self._post(self._mixed_file()).json()
        row3 = AssetImportRow.objects.get(import_run_id=res["import_id"], row_number=3)
        self.assertEqual(row3.data["Asset Name *"], "Bad cat")

    def test_a_row_lists_every_problem_at_once(self):
        upload = xlsx_upload([row(name=None, category="Spaceship", status="In Use", cost="-5")], HEADERS)
        res = self._post(upload, "validate/").json()
        cols = [e["column"] for e in res["failed_rows"][0]["errors"]]
        self.assertIn("Asset Name", cols)
        self.assertIn("Category", cols)
        self.assertIn("Purchase Cost", cols)
        self.assertIn("User", cols)   # "In Use" needs a User or a Department
        self.assertEqual(cols.count("Category"), 1)
