"""Shared fixtures for the asset tests (plain TestCase; tenants are flattened in tests)."""

from __future__ import annotations

import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership
from apps.itsm_rbac.models import Module, RoleAssignment, RoleModulePermission, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import invalidate_permission_cache

from ..models import AssetCategory, AssetField, AssetStatus
from ..services.starter import load_starter

User = get_user_model()
API = "/api/v1/itsm"
XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def seed_min():
    from apps.itsm_helpdesks.seed import run as seed_helpdesks

    seed_rbac()
    seed_helpdesks()


def make_user(username, role_code=None, helpdesk=None, **kw):
    u = User.objects.create_user(username=username, password="x", **kw)
    if role_code:
        RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code=role_code))
    if helpdesk is not None:
        HelpdeskMembership.objects.create(helpdesk=helpdesk, user=u, is_active=True,
                                          role_in_helpdesk="member")
    return u


def set_perm(role, code, **bits):
    mod = Module.objects.get(code=code)
    RoleModulePermission.objects.update_or_create(role=role, module=mod, defaults=bits)
    invalidate_permission_cache()


def xlsx_upload(rows, headers, name="assets.xlsx", sheet="Assets"):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(headers)
    for r in rows:
        ws.append(r)
    # Text starting with "=" stays text (as typed into a real sheet), not a formula.
    for line in ws.iter_rows(min_row=2):
        for cell in line:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                cell.data_type = "s"
    buf = io.BytesIO()
    wb.save(buf)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=XLSX_CT)


class AssetTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_min()
        cls.it = Helpdesk.objects.get(key="IT")
        cls.hr = Helpdesk.objects.get(key="HR")
        cls.admin = make_user("admin1", "admin", cls.it, full_name="Ada Admin", email="ada@x.test")
        cls.agent = make_user("agent1", "agent", cls.it, full_name="Ann Agent", email="ann@x.test")
        cls.hr_agent = make_user("hragent", "agent", cls.hr, full_name="Hal HR")
        cls.requestor = make_user("req1", "requestor", full_name="Rita Req", email="rita@x.test")
        load_starter(cls.it)
        cls.status = {s.key: s for s in AssetStatus.objects.all()}
        cats = AssetCategory.objects.filter(helpdesk=cls.it)
        cls.computer = cats.get(name="Computer", parent=None)
        cls.laptop = cats.get(name="Laptop", parent=cls.computer)
        cls.desktop = cats.get(name="Desktop", parent=cls.computer)
        cls.server = cats.get(name="Server", parent=None)
        cls.vm = cats.get(name="Virtual Machine", parent=cls.server)
        cls.printer = cats.get(name="Printer", parent=None)
        cls.field = {f.key: f for f in AssetField.objects.filter(helpdesk=cls.it)}

    def setUp(self):
        invalidate_permission_cache()
        self.client = APIClient()
        self.as_user(self.admin)

    def as_user(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def new_asset(self, **overrides):
        body = {
            "helpdesk": str(self.it.id), "name": "Dell Latitude 5440",
            "category": str(self.computer.id), "sub_category": str(self.laptop.id),
            "details": {"serial_number": "SN-1"},
        }
        body.update(overrides)
        return self.client.post(f"{API}/assets/", body, format="json")
